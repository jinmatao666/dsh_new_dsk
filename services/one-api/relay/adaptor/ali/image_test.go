package ali

import (
	"testing"

	"github.com/songquanpeng/one-api/relay/model"
)

// TestConvertWan27ImageRequest_SizeByReference 覆盖「有参考图时忽略像素尺寸、用档位保持比例」的修复。
// 背景：上游 getImageRequest 会把空 size 注入成 "1024x1024"，若直接透传会强制方形、丢掉参考图比例。
func TestConvertWan27ImageRequest_SizeByReference(t *testing.T) {
	cases := []struct {
		name     string
		req      model.ImageRequest
		wantSize string
	}{
		{
			name:     "单张参考图 + 注入的方形像素尺寸 → 强制 2K 档位",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "改蓝色", Image: "https://x/ref.png", Size: "1024x1024"},
			wantSize: "2K",
		},
		{
			name:     "多张参考图 + 具体像素尺寸 → 强制 2K 档位",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "合成", Images: []string{"https://x/a.png", "https://x/b.png"}, Size: "1440x1120"},
			wantSize: "2K",
		},
		{
			name:     "有参考图 + 显式档位 2K → 尊重档位",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "改图", Image: "https://x/ref.png", Size: "2K"},
			wantSize: "2K",
		},
		{
			name:     "有参考图 + 显式档位 4K → 尊重档位",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "改图", Image: "https://x/ref.png", Size: "4K"},
			wantSize: "4K",
		},
		{
			name:     "纯文生图（无参考图）+ 像素尺寸 → 透传（x→*）",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "画猫", Size: "1024x1536"},
			wantSize: "1024*1536",
		},
		{
			name:     "纯文生图 + 空尺寸 → 默认 2K",
			req:      model.ImageRequest{Model: "wan2.7-image", Prompt: "画猫", Size: ""},
			wantSize: "2K",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ConvertWan27ImageRequest(tc.req)
			if got.Parameters.Size != tc.wantSize {
				t.Fatalf("size = %q, want %q", got.Parameters.Size, tc.wantSize)
			}
		})
	}
}

// TestConvertWan27ImageRequest_RefContent 确认参考图被放进 multimodal content。
func TestConvertWan27ImageRequest_RefContent(t *testing.T) {
	req := ConvertWan27ImageRequest(model.ImageRequest{
		Model:  "wan2.7-image",
		Prompt: "合成",
		Images: []string{"https://x/a.png", "https://x/b.png"},
	})
	if len(req.Input.Messages) != 1 {
		t.Fatalf("messages len = %d, want 1", len(req.Input.Messages))
	}
	content := req.Input.Messages[0].Content
	// 2 张参考图 image block + 1 个 text block
	if len(content) != 3 {
		t.Fatalf("content len = %d, want 3", len(content))
	}
	if content[0].Image != "https://x/a.png" || content[1].Image != "https://x/b.png" {
		t.Fatalf("参考图未按顺序放入 content: %+v", content)
	}
	if content[2].Text != "合成" {
		t.Fatalf("prompt text 未放入 content: %+v", content[2])
	}
}
