package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var ErrMarketingVideoProcessing = errors.New("short video could not be normalized")

// MarketingPosterObjectKey stores the JPEG beside its immutable, approved video.
// Both objects are removed together by media reconciliation.
func MarketingPosterObjectKey(videoKey string) (string, error) {
	if !strings.HasSuffix(videoKey, ".mp4") || ValidateObjectKey(videoKey) != nil {
		return "", ErrInvalidObjectKey
	}
	key := strings.TrimSuffix(videoKey, ".mp4") + ".poster.jpg"
	if ValidateObjectKey(key) != nil {
		return "", ErrInvalidObjectKey
	}
	return key, nil
}

func runVideoCommand(ctx context.Context, executable string, args ...string) error {
	cmd := exec.CommandContext(ctx, executable, args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s: %v", ErrMarketingVideoProcessing, strings.TrimSpace(string(output)), err)
	}
	return nil
}

// NormalizeMarketingVideo creates a short, bounded, seekable H.264/AAC MP4 and
// a JPEG first-frame poster. Reuse the DSH container's FFmpeg tooling instead
// of adding a new queue/worker/service. Uploads fail closed when FFmpeg is not
// installed, times out, or rejects the media.
func NormalizeMarketingVideo(parent context.Context, input []byte) ([]byte, []byte, error) {
	if err := ValidateMarketingMP4Bytes(input); err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(parent, 45*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp("", "bthwani-marketing-video-")
	if err != nil {
		return nil, nil, ErrMarketingVideoProcessing
	}
	defer os.RemoveAll(dir)
	source := filepath.Join(dir, "source.mp4")
	output := filepath.Join(dir, "normalized.mp4")
	poster := filepath.Join(dir, "poster.jpg")
	if err := os.WriteFile(source, input, 0600); err != nil {
		return nil, nil, ErrMarketingVideoProcessing
	}
	// Do not silently cut promotional videos; reject overly long uploads.
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source)
	durationBytes, err := probe.Output()
	if err != nil {
		return nil, nil, ErrMarketingVideoProcessing
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(durationBytes)), 64)
	if err != nil || duration <= 0 || duration > 30 {
		return nil, nil, ErrMarketingVideoProcessing
	}
	// Bound decoded pixel counts before invoking the decoder/transcoder.
	probeVideo := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", source)
	dimensions, err := probeVideo.Output()
	if err != nil {
		return nil, nil, ErrMarketingVideoProcessing
	}
	parts := strings.Split(strings.TrimSpace(string(dimensions)), ",")
	if len(parts) != 2 {
		return nil, nil, ErrMarketingVideoProcessing
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width < 2 || height < 2 || width > 3840 || height > 3840 || int64(width)*int64(height) > 3840*2160 {
		return nil, nil, ErrMarketingVideoProcessing
	}
	if err := runVideoCommand(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", source,
		"-map", "0:v:0", "-map", "0:a:0?", "-t", "30",
		"-vf", "scale=w='trunc(min(540,iw)/2)*2':h=-2:flags=bicubic,fps=24",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "27",
		"-maxrate", "950k", "-bufsize", "1900k", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "64k", "-ac", "1",
		"-movflags", "+faststart", "-map_metadata", "-1", output); err != nil {
		return nil, nil, err
	}
	if err := runVideoCommand(ctx, "ffmpeg", "-nostdin", "-v", "error", "-y",
		"-i", output, "-frames:v", "1", "-q:v", "5", poster); err != nil {
		return nil, nil, err
	}
	videoBytes, err := os.ReadFile(output)
	if err != nil || len(videoBytes) < 32 || int64(len(videoBytes)) > MaxUploadBytes {
		return nil, nil, ErrMarketingVideoProcessing
	}
	imageBytes, err := os.ReadFile(poster)
	if err != nil || len(imageBytes) < 1 || len(imageBytes) > 1024*1024 {
		return nil, nil, ErrMarketingVideoProcessing
	}
	if _, _, _, err := ValidateImageBytes(imageBytes); err != nil {
		return nil, nil, ErrMarketingVideoProcessing
	}
	return videoBytes, imageBytes, nil
}
