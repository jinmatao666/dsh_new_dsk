package ali

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/relay/adaptor"
	"github.com/songquanpeng/one-api/relay/meta"
	"github.com/songquanpeng/one-api/relay/model"
	"github.com/songquanpeng/one-api/relay/relaymode"
	"io"
	"net/http"
	"strings"
)

// https://help.aliyun.com/zh/dashscope/developer-reference/api-details

// isImageEditModel 判断是否为万相图像编辑模型（wanx2.1-imageedit，走 image2image 异步接口，仅高清超分用）。
func isImageEditModel(model string) bool {
	return strings.Contains(model, "imageedit")
}

// isWan27EditModel 判断是否为 wan2.7 系图像编辑模型（走 multimodal-generation 同步接口，纯指令编辑）。
// wan2.7-image / wan2.7-image-pro：传原图 + 自然语言指令，无 mask、无 function、同步一次返回。
func isWan27EditModel(model string) bool {
	return strings.HasPrefix(model, "wan2.7-image") || strings.HasPrefix(model, "wan2.6-image") || strings.HasPrefix(model, "wan2.5")
}

type Adaptor struct {
	meta *meta.Meta
}

func (a *Adaptor) Init(meta *meta.Meta) {
	a.meta = meta
}

func (a *Adaptor) GetRequestURL(meta *meta.Meta) (string, error) {
	fullRequestURL := ""
	switch meta.Mode {
	case relaymode.Embeddings:
		fullRequestURL = fmt.Sprintf("%s/api/v1/services/embeddings/text-embedding/text-embedding", meta.BaseURL)
	case relaymode.ImagesGenerations:
		// wan2.7 系图像编辑走 multimodal 同步接口；wanx*-imageedit 走 image2image 异步；其余文生图走 text2image 异步。
		if isWan27EditModel(meta.ActualModelName) {
			fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/multimodal-generation/generation", meta.BaseURL)
		} else if isImageEditModel(meta.ActualModelName) {
			fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/image2image/image-synthesis", meta.BaseURL)
		} else {
			fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/text2image/image-synthesis", meta.BaseURL)
		}
	default:
		fullRequestURL = fmt.Sprintf("%s/api/v1/services/aigc/text-generation/generation", meta.BaseURL)
	}

	return fullRequestURL, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Request, meta *meta.Meta) error {
	adaptor.SetupCommonRequestHeader(c, req, meta)
	if meta.IsStream {
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("X-DashScope-SSE", "enable")
	}
	req.Header.Set("Authorization", "Bearer "+meta.APIKey)

	// wan2.7 系走 multimodal 同步接口，不能带异步头；其余图像模型（wanx/text2image）异步。
	if meta.Mode == relaymode.ImagesGenerations && !isWan27EditModel(meta.ActualModelName) {
		req.Header.Set("X-DashScope-Async", "enable")
	}
	if a.meta.Config.Plugin != "" {
		req.Header.Set("X-DashScope-Plugin", a.meta.Config.Plugin)
	}
	return nil
}

func (a *Adaptor) ConvertRequest(c *gin.Context, relayMode int, request *model.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	switch relayMode {
	case relaymode.Embeddings:
		aliEmbeddingRequest := ConvertEmbeddingRequest(*request)
		return aliEmbeddingRequest, nil
	default:
		aliRequest := ConvertRequest(*request)
		return aliRequest, nil
	}
}

func (a *Adaptor) ConvertImageRequest(request *model.ImageRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	// wan2.7 系走 multimodal 同步结构；wanx/文生图走原异步结构。
	if isWan27EditModel(request.Model) {
		return ConvertWan27ImageRequest(*request), nil
	}
	aliRequest := ConvertImageRequest(*request)
	return aliRequest, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, meta *meta.Meta, requestBody io.Reader) (*http.Response, error) {
	return adaptor.DoRequestHelper(a, c, meta, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, meta *meta.Meta) (usage *model.Usage, err *model.ErrorWithStatusCode) {
	if meta.IsStream {
		err, usage = StreamHandler(c, resp)
	} else {
		switch meta.Mode {
		case relaymode.Embeddings:
			err, usage = EmbeddingHandler(c, resp)
		case relaymode.ImagesGenerations:
			// wan2.7 系同步返回，直接解析；其余图像模型走异步轮询 Handler。
			if isWan27EditModel(meta.ActualModelName) {
				err, usage = Wan27ImageHandler(c, resp)
			} else {
				err, usage = ImageHandler(c, resp)
			}
		default:
			err, usage = Handler(c, resp)
		}
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return "ali"
}
