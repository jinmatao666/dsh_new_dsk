package ali

import (
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/model"
)

type Message struct {
	Content string `json:"content"`
	Role    string `json:"role"`
}

type Input struct {
	//Prompt   string       `json:"prompt"`
	Messages []Message `json:"messages"`
}

type Parameters struct {
	TopP              *float64     `json:"top_p,omitempty"`
	TopK              int          `json:"top_k,omitempty"`
	Seed              uint64       `json:"seed,omitempty"`
	EnableSearch      bool         `json:"enable_search,omitempty"`
	IncrementalOutput bool         `json:"incremental_output,omitempty"`
	MaxTokens         int          `json:"max_tokens,omitempty"`
	Temperature       *float64     `json:"temperature,omitempty"`
	ResultFormat      string       `json:"result_format,omitempty"`
	Tools             []model.Tool `json:"tools,omitempty"`
}

type ChatRequest struct {
	Model      string     `json:"model"`
	Input      Input      `json:"input"`
	Parameters Parameters `json:"parameters,omitempty"`
}

type ImageRequest struct {
	Model string `json:"model"`
	Input struct {
		// Function 用于图像编辑（wanx2.1-imageedit），DashScope 要求置于 input 内。
		Function       string `json:"function,omitempty"`
		Prompt         string `json:"prompt"`
		NegativePrompt string `json:"negative_prompt,omitempty"`
		// 图像编辑输入：原图与蒙版（URL 或 base64）。
		BaseImageURL string `json:"base_image_url,omitempty"`
		MaskImageURL string `json:"mask_image_url,omitempty"`
	} `json:"input"`
	Parameters struct {
		Size  string `json:"size,omitempty"`
		N     int    `json:"n,omitempty"`
		Steps string `json:"steps,omitempty"`
		Scale string `json:"scale,omitempty"`
		// 图像编辑参数。
		Strength      float64 `json:"strength,omitempty"`
		UpscaleFactor int     `json:"upscale_factor,omitempty"`
		TopScale      float64 `json:"top_scale,omitempty"`
		BottomScale   float64 `json:"bottom_scale,omitempty"`
		LeftScale     float64 `json:"left_scale,omitempty"`
		RightScale    float64 `json:"right_scale,omitempty"`
	} `json:"parameters,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
}

// Wan27ImageRequest：wan2.7 系图像编辑/生成的 multimodal 同步请求体。
// 原图与指令都放在 input.messages[].content[]（image 传 URL/base64，text 传指令）。
type Wan27ImageRequest struct {
	Model string `json:"model"`
	Input struct {
		Messages []Wan27Message `json:"messages"`
	} `json:"input"`
	Parameters struct {
		Size      string `json:"size,omitempty"`
		N         int    `json:"n,omitempty"`
		Watermark bool   `json:"watermark,omitempty"`
	} `json:"parameters,omitempty"`
}

type Wan27Message struct {
	Role    string          `json:"role"`
	Content []Wan27Content  `json:"content"`
}

type Wan27Content struct {
	Image string `json:"image,omitempty"`
	Text  string `json:"text,omitempty"`
}

// Wan27Response：multimodal 同步响应，图片在 output.choices[].message.content[].image。
type Wan27Response struct {
	Output struct {
		Choices []struct {
			FinishReason string `json:"finish_reason,omitempty"`
			Message      struct {
				Content []struct {
					Image string `json:"image,omitempty"`
				} `json:"content,omitempty"`
			} `json:"message,omitempty"`
		} `json:"choices,omitempty"`
	} `json:"output,omitempty"`
	Usage struct {
		ImageCount int `json:"image_count,omitempty"`
	} `json:"usage,omitempty"`
	Code      string `json:"code,omitempty"`
	Message   string `json:"message,omitempty"`
	RequestId string `json:"request_id,omitempty"`
}

type TaskResponse struct {
	StatusCode int    `json:"status_code,omitempty"`
	RequestId  string `json:"request_id,omitempty"`
	Code       string `json:"code,omitempty"`
	Message    string `json:"message,omitempty"`
	Output     struct {
		TaskId     string `json:"task_id,omitempty"`
		TaskStatus string `json:"task_status,omitempty"`
		Code       string `json:"code,omitempty"`
		Message    string `json:"message,omitempty"`
		Results    []struct {
			B64Image string `json:"b64_image,omitempty"`
			Url      string `json:"url,omitempty"`
			Code     string `json:"code,omitempty"`
			Message  string `json:"message,omitempty"`
		} `json:"results,omitempty"`
		TaskMetrics struct {
			Total     int `json:"TOTAL,omitempty"`
			Succeeded int `json:"SUCCEEDED,omitempty"`
			Failed    int `json:"FAILED,omitempty"`
		} `json:"task_metrics,omitempty"`
	} `json:"output,omitempty"`
	Usage Usage `json:"usage"`
}

type Header struct {
	Action       string `json:"action,omitempty"`
	Streaming    string `json:"streaming,omitempty"`
	TaskID       string `json:"task_id,omitempty"`
	Event        string `json:"event,omitempty"`
	ErrorCode    string `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
	Attributes   any    `json:"attributes,omitempty"`
}

type Payload struct {
	Model      string `json:"model,omitempty"`
	Task       string `json:"task,omitempty"`
	TaskGroup  string `json:"task_group,omitempty"`
	Function   string `json:"function,omitempty"`
	Parameters struct {
		SampleRate int     `json:"sample_rate,omitempty"`
		Rate       float64 `json:"rate,omitempty"`
		Format     string  `json:"format,omitempty"`
	} `json:"parameters,omitempty"`
	Input struct {
		Text string `json:"text,omitempty"`
	} `json:"input,omitempty"`
	Usage struct {
		Characters int `json:"characters,omitempty"`
	} `json:"usage,omitempty"`
}

type WSSMessage struct {
	Header  Header  `json:"header,omitempty"`
	Payload Payload `json:"payload,omitempty"`
}

type EmbeddingRequest struct {
	Model string `json:"model"`
	Input struct {
		Texts []string `json:"texts"`
	} `json:"input"`
	Parameters *struct {
		TextType string `json:"text_type,omitempty"`
	} `json:"parameters,omitempty"`
}

type Embedding struct {
	Embedding []float64 `json:"embedding"`
	TextIndex int       `json:"text_index"`
}

type EmbeddingResponse struct {
	Output struct {
		Embeddings []Embedding `json:"embeddings"`
	} `json:"output"`
	Usage Usage `json:"usage"`
	Error
}

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestId string `json:"request_id"`
}

type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

type Output struct {
	//Text         string                      `json:"text"`
	//FinishReason string                      `json:"finish_reason"`
	Choices []openai.TextResponseChoice `json:"choices"`
}

type ChatResponse struct {
	Output Output `json:"output"`
	Usage  Usage  `json:"usage"`
	Error
}
