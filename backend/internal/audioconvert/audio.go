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
// Implementação:
//   - ffmpeg lê de stdin (-i pipe:0) e escreve em stdout (-f ogg pipe:1).
//   - Encoder libopus sempre (mesmo se input já é Opus) — barato e garante
//     que o container seja OGG. Re-encoding de Opus pra Opus tem perda mas
//     é imperceptível em 32kbps voz.
//   - VBR ativo (-vbr on) com bitrate target 32k.
//   - application=voip otimiza pra fala (menor latência, menos bits em
//     silêncio).
//   - Duração é extraída do stderr do ffmpeg ("Duration: HH:MM:SS.xx").
//   - Timeout de 30s pra cortar áudios travados/grandes demais.
func TranscodeToOggOpus(ctx context.Context, in []byte) ([]byte, uint32, error) {
	if !ffmpegOK.Load() {
		return nil, 0, ErrFfmpegMissing
	}
	if len(in) == 0 {
		return nil, 0, errors.New("audioconvert: input vazio")
	}

	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(tctx, ffmpegPath,
		"-hide_banner",
		"-loglevel", "info", // precisa de info pra capturar Duration no stderr
		"-i", "pipe:0",
		"-vn",                       // descarta vídeo se houver (ex.: WebM com track de vídeo)
		"-c:a", "libopus",
		"-application", "voip",
		"-vbr", "on",
		"-b:a", "32k",
		"-ar", "16000",              // sample rate típico de voz
		"-ac", "1",                  // mono — economiza bits e voice notes são mono
		"-f", "ogg",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(in)

	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Anexa ultimas linhas do stderr — trace real do problema costuma
		// estar nas últimas 3 linhas (ex.: "Invalid data found", "moov atom not found").
		tail := tailString(stderr.String(), 3)
		return nil, 0, fmt.Errorf("ffmpeg falhou: %w (stderr: %s)", err, tail)
	}

	dur := parseDurationSeconds(stderr.String())
	if dur == 0 {
		// Estimativa fallback: bytes / (32kbps / 8) = bytes / 4000.
		// Não é exato mas não deixa o campo zerado pra PTT.
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
