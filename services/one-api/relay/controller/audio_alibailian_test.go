package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildAliBailianTranscriptionRequest(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("model", "qwen-audio-3.0-asr-flash"))
	file, err := writer.CreateFormFile("file", "segment.wav")
	require.NoError(t, err)
	audio := []byte("wav bytes")
	_, err = file.Write(audio)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	encoded, err := buildAliBailianTranscriptionRequest(body.Bytes(), writer.FormDataContentType(), "provider-model")
	require.NoError(t, err)
	var request aliBailianTranscriptionRequest
	require.NoError(t, json.Unmarshal(encoded, &request))
	require.Equal(t, "provider-model", request.Model)
	require.Equal(t, "wav", request.Parameters.Format)
	require.Equal(t, 16000, request.Parameters.SampleRate)
	require.Len(t, request.Input.Messages, 1)
	data := request.Input.Messages[0].Content[0].InputAudio.Data
	require.Equal(t, "data:audio/wav;base64,"+base64.StdEncoding.EncodeToString(audio), data)
}

func TestConvertAliBailianTranscriptionResponse(t *testing.T) {
	body := []byte(`{"output":{"text":"会议转写内容"}}`)

	jsonBody, err := convertAliBailianTranscriptionResponse(body, "json")
	require.NoError(t, err)
	require.JSONEq(t, `{"text":"会议转写内容"}`, string(jsonBody))

	textBody, err := convertAliBailianTranscriptionResponse(body, "text")
	require.NoError(t, err)
	require.Equal(t, "会议转写内容", string(textBody))
}

func TestAliBailianTranscriptionURLAcceptsCompatibleBaseURL(t *testing.T) {
	require.Equal(
		t,
		"https://workspace.example.com/api/v1/services/aigc/multimodal-generation/generation",
		aliBailianTranscriptionURL("https://workspace.example.com/compatible-mode/v1"),
	)
}
