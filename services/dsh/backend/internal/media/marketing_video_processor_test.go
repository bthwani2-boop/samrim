package media

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMarketingPosterObjectKey(t *testing.T) {
	video, err := KeyForMarketingUpload("short-test", "request-123", strings.Repeat("a", 64), "video/mp4")
	if err != nil {
		t.Fatal(err)
	}
	poster, err := MarketingPosterObjectKey(video)
	if err != nil || !strings.HasSuffix(poster, ".poster.jpg") || poster == video {
		t.Fatalf("invalid poster key %q: %v", poster, err)
	}
	for _, bad := range []string{"", "unsafe/../video.mp4", "store/image.png"} {
		if _, err := MarketingPosterObjectKey(bad); err == nil {
			t.Fatalf("accepted invalid key: %q", bad)
		}
	}
}

func TestMarketingVideoProcessorRejectsFakeMP4(t *testing.T) {
	if _, _, err := NormalizeMarketingVideo(context.Background(), []byte("not a video")); err == nil {
		t.Fatal("invalid video accepted")
	}
}

func TestNormalizeMarketingVideoWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg not installed on the test host")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("FFprobe not installed on the test host")
	}
	folder := t.TempDir()
	src := filepath.Join(folder, "source.mp4")
	cmd := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x568:r=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", src)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture video failed: %v: %s", err, output)
	}
	bytes, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	normalized, poster, err := NormalizeMarketingVideo(context.Background(), bytes)
	if err != nil {
		t.Fatalf("valid short video rejected: %v", err)
	}
	if len(normalized) < 32 || len(poster) < 32 {
		t.Fatal("missing normalized video or thumbnail")
	}
	if imageType, _, _, err := ValidateImageBytes(poster); err != nil || imageType != "image/jpeg" {
		t.Fatalf("invalid generated JPEG: %v", err)
	}
}
