package controller

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"

	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/relay/channeltype"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// ProbeAudioTranscription verifies an audio model through its configured channel.
func ProbeAudioTranscription(ctx context.Context, channel *model.Channel, requestedModel string) (string, error, *relaymodel.Error) {
	actualModel := requestedModel
	if mapping := channel.GetModelMapping(); mapping != nil && mapping[actualModel] != "" {
		actualModel = mapping[actualModel]
	}

	var multipartBody bytes.Buffer
	writer := multipart.NewWriter(&multipartBody)
	if err := writer.WriteField("model", actualModel); err != nil {
		return "", err, nil
	}
	if err := writer.WriteField("response_format", "json"); err != nil {
		return "", err, nil
	}
	file, err := writer.CreateFormFile("file", "connectivity-test.wav")
	if err != nil {
		return "", err, nil
	}
	if _, err := file.Write(audioProbeWAV()); err != nil {
		return "", err, nil
	}
	if err := writer.Close(); err != nil {
		return "", err, nil
	}

	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		baseURL = channeltype.ChannelBaseURLs[channel.Type]
	}
	requestBody := multipartBody.Bytes()
	contentType := writer.FormDataContentType()
	requestURL := openai.GetFullRequestURL(baseURL, "/v1/audio/transcriptions", channel.Type)
	aliBailian := channel.Type == channeltype.AliBailian
	if aliBailian {
		requestBody, err = buildAliBailianTranscriptionRequest(requestBody, contentType, actualModel)
		if err != nil {
			return "", err, nil
		}
		contentType = "application/json"
		requestURL = aliBailianTranscriptionURL(baseURL)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(requestBody))
	if err != nil {
		return "", err, nil
	}
	req.Header.Set("Authorization", "Bearer "+channel.Key)
	req.Header.Set("Content-Type", contentType)
	if aliBailian {
		req.Header.Set("X-DashScope-SSE", "disable")
	}

	resp, err := client.HTTPClient.Do(req)
	if err != nil {
		return "", err, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		relayErr := RelayErrorHandler(resp)
		message := relayErr.Error.Message
		if message != "" {
			message = ", error message: " + message
		}
		return "", fmt.Errorf("http status code: %d%s", resp.StatusCode, message), &relayErr.Error
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err, nil
	}
	text, err := probeTranscriptionText(body, aliBailian)
	if err != nil {
		return "", err, nil
	}
	if text == "" {
		return "音频接口连通，测试音频未识别出文字", nil, nil
	}
	return "音频接口连通，识别结果：" + text, nil, nil
}

func probeTranscriptionText(body []byte, aliBailian bool) (string, error) {
	if aliBailian {
		var response aliBailianTranscriptionResponse
		if err := json.Unmarshal(body, &response); err != nil {
			return "", fmt.Errorf("unmarshal transcription response: %w", err)
		}
		if response.Code != "" {
			return "", fmt.Errorf("%s: %s", response.Code, response.Message)
		}
		if response.Output.Text != "" {
			return response.Output.Text, nil
		}
		return response.Output.Sentence.Text, nil
	}
	var response openai.WhisperJSONResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("unmarshal transcription response: %w", err)
	}
	return response.Text, nil
}

func audioProbeWAV() []byte {
	const sampleRate = 16000
	const sampleCount = sampleRate
	const dataSize = sampleCount * 2
	buffer := bytes.NewBuffer(make([]byte, 0, 44+dataSize))
	buffer.WriteString("RIFF")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(36+dataSize))
	buffer.WriteString("WAVEfmt ")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(16))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(1))
	_ = binary.Write(buffer, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(buffer, binary.LittleEndian, uint32(sampleRate*2))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(2))
	_ = binary.Write(buffer, binary.LittleEndian, uint16(16))
	buffer.WriteString("data")
	_ = binary.Write(buffer, binary.LittleEndian, uint32(dataSize))
	for index := 0; index < sampleCount; index++ {
		sample := int16(math.Sin(2*math.Pi*440*float64(index)/sampleRate) * 1200)
		_ = binary.Write(buffer, binary.LittleEndian, sample)
	}
	return buffer.Bytes()
}
