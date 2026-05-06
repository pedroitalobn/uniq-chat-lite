// Package audioconvert isola a transcodagem de áudio em OGG/Opus, formato
// que o WhatsApp aceita como voice note (PTT). Usa ffmpeg via stdin/stdout
// — sem arquivos temporários, sem ffprobe separado (a duração é parseada
// do stderr do ffmpeg).
//
// O pipeline frontend grava em WebM/Opus (Chrome) ou MP4/AAC (Safari).
// Mandar esses bytes diretos pro WhatsApp anunciando "audio/ogg" é a
// causa raiz do "áudio indisponível": o cliente parseia o header,
// encontra container errado e descarta. Transcodar pra OGG resolve.
package audioconvert

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
)

// ffmpegAvailable é checado uma vez. Se não tiver no $PATH, TranscodeToOggOpus
// devolve erro determinístico — caller decide se faz fallback (manda os
// bytes originais) ou aborta. Cache evita exec.LookPath em todo request.
var (
	ffmpegPath string
	ffmpegOnce sync.Once
	ffmpegOK   atomic.Bool
)

func init() {
	ffmpegOnce.Do(func() {
		path, err := exec.LookPath("ffmpeg")
		if err != nil {
			log.Warn().Msg("audioconvert: ffmpeg não encontrado no PATH — voice notes vão sair sem transcoding (provável 'áudio indisponível' no destinatário)")
			return
		}
		ffmpegPath = path
		ffmpegOK.Store(true)
		log.Info().Str("path", path).Msg("audioconvert: ffmpeg disponível")
	})
}

// Available retorna true quando ffmpeg foi localizado no PATH.
func Available() bool {
	return ffmpegOK.Load()
}

// ErrFfmpegMissing indica que ffmpeg não está instalado. O caller pode
// tratar isso como "vai como veio" (best-effort) ou logar warn alto.
var ErrFfmpegMissing = errors.New("audioconvert: ffmpeg ausente — instale o pacote ffmpeg na imagem")

// TranscodeToOggOpus normaliza qualquer container de áudio (WebM, MP4, MP3,
// AAC, WAV) em OGG/Opus mono 16kHz 32kbps — o sweet spot pra voice notes
// no WhatsApp. Retorna (bytes OGG, duração em segundos, erro).
//
// Estratégia em 2 etapas:
//
//  1. Try lossless repack: `-c:a copy -f ogg`. Funciona quando o input
//     já contém Opus em outro container (WebM/Matroska — comum no
//     browser MediaRecorder). Extrai pacotes Opus 1:1 e empacota em
//     OGG, sem re-encode. Bit-exato. Mais rápido, sem perda.
//
//  2. Fallback re-encode: `-c:a libopus -application voip -vbr on
//     -b:a 32k -ar 16000 -ac 1`. Usado quando o input não é Opus
//     (MP3, AAC, WAV) — ou quando o copy falhou (ex.: timestamps
//     inconsistentes do WebM, comum em mics com sample rate
//     incomum).
//
// Duração é extraída do stderr do ffmpeg ("Duration: HH:MM:SS.xx").
func TranscodeToOggOpus(ctx context.Context, in []byte) ([]byte, uint32, error) {
	if !ffmpegOK.Load() {
		return nil, 0, ErrFfmpegMissing
	}
	if len(in) == 0 {
		return nil, 0, errors.New("audioconvert: input vazio")
	}

	// Tentativa 1: lossless repack (Opus passa puro pra OGG).
	if out, dur, err := transcodeOpusCopy(ctx, in); err == nil && len(out) > 0 {
		return out, dur, nil
	} else if err != nil {
		log.Debug().Err(err).Msg("audioconvert: copy fallback pra re-encode")
	}

	// Tentativa 2: re-encode pra normalizar.
	return transcodeReencode(ctx, in)
}

// transcodeOpusCopy tenta -c:a copy. Falha se o input não contém Opus ou
// se o demuxer/muxer não consegue reorganizar timestamps. Diferença chave
// vs re-encode: NÃO toca os pacotes Opus, só remete pro container OGG.
// Isso evita artefatos sutis de encoding que alguns clients WhatsApp
// rejeitam ("este áudio não está mais disponível").
func transcodeOpusCopy(ctx context.Context, in []byte) ([]byte, uint32, error) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, ffmpegPath,
		"-hide_banner",
		"-loglevel", "info",
		"-i", "pipe:0",
		"-vn",
		"-c:a", "copy",
		"-f", "ogg",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(in)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		tail := tailString(stderr.String(), 3)
		return nil, 0, fmt.Errorf("ffmpeg copy: %w (stderr: %s)", err, tail)
	}
	dur := parseDurationSeconds(stderr.String())
	if dur == 0 {
		dur = uint32(len(out.Bytes()) / 4000)
		if dur == 0 {
			dur = 1
		}
	}
	return out.Bytes(), dur, nil
}

// transcodeReencode é o caminho original (re-encode com libopus). Usado
// quando copy falha — mantém o áudio entregue a custo de qualidade.
func transcodeReencode(ctx context.Context, in []byte) ([]byte, uint32, error) {
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, ffmpegPath,
		"-hide_banner",
		"-loglevel", "info",
		"-i", "pipe:0",
		"-vn",
		"-c:a", "libopus",
		"-application", "voip",
		"-vbr", "on",
		"-b:a", "32k",
		"-ar", "16000",
		"-ac", "1",
		"-f", "ogg",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(in)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		tail := tailString(stderr.String(), 3)
		return nil, 0, fmt.Errorf("ffmpeg re-encode: %w (stderr: %s)", err, tail)
	}
	dur := parseDurationSeconds(stderr.String())
	if dur == 0 {
		est := uint32(len(out.Bytes()) / 4000)
		if est > 0 {
			dur = est
		} else {
			dur = 1
		}
	}
	return out.Bytes(), dur, nil
}

// durRegex captura "Duration: HH:MM:SS.xx," do stderr do ffmpeg.
var durRegex = regexp.MustCompile(`Duration: (\d+):(\d+):(\d+)\.(\d+)`)

func parseDurationSeconds(stderr string) uint32 {
	m := durRegex.FindStringSubmatch(stderr)
	if len(m) != 5 {
		return 0
	}
	h, _ := strconv.Atoi(m[1])
	min, _ := strconv.Atoi(m[2])
	s, _ := strconv.Atoi(m[3])
	cs, _ := strconv.Atoi(m[4]) // centissegundos
	total := h*3600 + min*60 + s
	if cs >= 50 {
		total++
	}
	if total < 0 {
		return 0
	}
	return uint32(total)
}

// tailString devolve as últimas n linhas non-vazias de s — útil pra mensagens
// de erro do ffmpeg que cospem MB de log mas só interessa o final.
func tailString(s string, n int) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	out := make([]string, 0, n)
	for i := len(lines) - 1; i >= 0 && len(out) < n; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		out = append([]string{l}, out...)
	}
	return strings.Join(out, " | ")
}

// _ keeps io imported for future probe variants.
var _ = io.Discard
