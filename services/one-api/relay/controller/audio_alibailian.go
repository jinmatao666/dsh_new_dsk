package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"path/filepath"
	"strings"
)

type aliBailianTranscriptionRequest struct {
	Model string `json:"model"`
	Input struct {
		Messages []aliBailianAudioMessage `json:"messages"`
	} `json:"input"`
	Parameters aliBailianAudioParameters `json:"parameters"`
}

type aliBailianAudioMessage struct {
	Role    string                   `json:"role"`
	Content []aliBailianAudioContent `json:"content"`
}

type aliBailianAudioContent struct {
	Type       string               `json:"type"`
	InputAudio aliBailianInputAudio `json:"input_audio"`
}

type aliBailianInputAudio struct {
	Data string `json:"data"`
}

type aliBailianAudioParameters struct {
	Format     string `json:"format"`
	SampleRate int    `json:"sample_rate"`
}

type aliBailianTranscriptionResponse struct {
	Output struct {
		Text     string `json:"text"`
		Sentence struct {
			Text string `json:"text"`
		} `json:"sentence"`
	} `json:"output"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func aliBailianTranscriptionURL(baseURL string) string {
	baseURL = strings.TrimRight(baseURL, "/")
	baseURL = strings.TrimSuffix(baseURL, "/compatible-mode/v1")
	baseURL = strings.TrimSuffix(baseURL, "/api/v1")
	return baseURL + "/api/v1/services/aigc/multimodal-generation/generation"
}

func buildAliBailianTranscriptionRequest(body []byte, contentType string, modelName string) ([]byte, error) {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, fmt.Errorf("parse content type: %w", err)
	}
	if mediaType != "multipart/form-data" {
		return nil, fmt.Errorf("expected multipart/form-data, got %s", mediaType)
	}
	boundary := params["boundary"]
	if boundary == "" {
		return nil, fmt.Errorf("multipart boundary is missing")
	}

	var audio []byte
	filename := "audio.wav"
	audioMediaType := "audio/wav"
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read multipart part: %w", err)
		}
		if part.FormName() != "file" {
			continue
		}
		audio, err = io.ReadAll(part)
		if err != nil {
			return nil, fmt.Errorf("read audio file: %w", err)
		}
		if part.FileName() != "" {
			filename = part.FileName()
		}
		if part.Header.Get("Content-Type") != "" {
			audioMediaType = part.Header.Get("Content-Type")
		}
		break
	}
	if len(audio) == 0 {
		return nil, fmt.Errorf("audio file is missing or empty")
	}

	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(filename)), ".")
	if format == "" {
		format = "wav"
	}
	if audioMediaType == "application/octet-stream" {
		switch format {
		case "wav":
			audioMediaType = "audio/wav"
		case "mp3":
			audioMediaType = "audio/mpeg"
		case "m4a":
			audioMediaType = "audio/mp4"
		}
	}
	request := aliBailianTranscriptionRequest{Model: modelName}
	request.Input.Messages = []aliBailianAudioMessage{{
		Role: "user",
		Content: []aliBailianAudioContent{{
			Type: "input_audio",
			InputAudio: aliBailianInputAudio{
				Data: "data:" + audioMediaType + ";base64," + base64.StdEncoding.EncodeToString(audio),
			},
		}},
	}}
	request.Parameters = aliBailianAudioParameters{Format: format, SampleRate: 16000}
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("marshal transcription request: %w", err)
	}
	return encoded, nil
}

func convertAliBailianTranscriptionResponse(body []byte, responseFormat string) ([]byte, error) {
	var response aliBailianTranscriptionResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("unmarshal transcription response: %w", err)
	}
	if response.Code != "" {
		return nil, fmt.Errorf("%s: %s", response.Code, response.Message)
	}
	text := response.Output.Text
	if text == "" {
		text = response.Output.Sentence.Text
	}
	if text == "" {
		return nil, fmt.Errorf("transcription response has no output text")
	}

	switch responseFormat {
	case "json", "verbose_json":
		encoded, err := json.Marshal(struct {
			Text string `json:"text"`
		}{Text: text})
		if err != nil {
			return nil, fmt.Errorf("marshal transcription response: %w", err)
		}
		return encoded, nil
	case "text":
		return []byte(text), nil
	default:
		return nil, fmt.Errorf("response format %q is not supported by Ali Bailian transcription", responseFormat)
	}
}

func aliBailianResponseContentType(responseFormat string) string {
	if responseFormat == "text" {
		return "text/plain; charset=utf-8"
	}
	return "application/json"
}
