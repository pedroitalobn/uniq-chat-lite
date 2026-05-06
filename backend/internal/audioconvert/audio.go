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
// AAC, WAV) em OGG/Opus mono 48kHz 32kbps — o que o WhatsApp aceita como
// voice note (PTT). Retorna (bytes OGG, duração em segundos, erro).
//
// Histórico: tentamos um lossless repack (`-c:a copy -f ogg`) antes do
// re-encode, achando que economizaria um round-trip de codec quando
// o input já era Opus (WebM/MediaRecorder do browser). Não funcionou
// confiavelmente — alguns mics (USB Fifine, p.ex.) produzem WebM com
// timestamps/page boundaries que o ffmpeg `copy` remete pro OGG mas
// que o WhatsApp do recipient rejeita silenciosamente, mostrando
// "áudio indisponível". Re-encode com libopus corrige porque ele
// rebuilda o OpusHead, granule positions e page durations num arquivo
// que sempre passa nos parsers de cliente. Diferença de qualidade é
// imperceptível em voz a 32kbps voip; ganho de robustez é total.
//
// Sample rate: 48kHz (Opus internamente é 48k de qualquer jeito; forçar
// downsample pra 16k descarta info sem benefício real e às vezes
// causa rejeição em algumas builds antigas do WhatsApp).
//
// Duração é extraída do stderr do ffmpeg ("Duration: HH:MM:SS.xx").
func TranscodeToOggOpus(ctx context.Context, in []byte) ([]byte, uint32, error) {
	if !ffmpegOK.Load() {
		return nil, 0, ErrFfmpegMissing
	}
	if len(in) == 0 {
		return nil, 0, errors.New("audioconvert: input vazio")
	}
	return transcodeReencode(ctx, in)
}

// transcodeReencode roda libopus em modo voip, mono, 48kHz, 32kbps VBR
// — perfil "voice note do WhatsApp". Page duration de 60ms é o que
// o cliente mobile espera; sem isso alguns devices truncam o playback.
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
		"-ar", "48000",
		"-ac", "1",
		// Page duration de 60ms — alinhado ao que o cliente WhatsApp
		// usa na hora de gerar voice notes. Páginas mais longas
		// (default 1s) fizeram alguns devices mostrarem "indisponível".
		"-page_duration", "60000",
		"-frame_duration", "60",
		"-f", "ogg",
		"pipe:1",
	)
	cmd.Stdin = bytes.NewReader(in)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		tail := tailString(stderr.String(), 5)
		log.Error().Err(err).Str("stderr", tail).Int("input_bytes", len(in)).Msg("audioconvert: re-encode falhou")
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
	log.Debug().Int("input_bytes", len(in)).Int("output_bytes", out.Len()).
		Uint32("duration_s", dur).Msg("audioconvert: re-encode OK")
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
