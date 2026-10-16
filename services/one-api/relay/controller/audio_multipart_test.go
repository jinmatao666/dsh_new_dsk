package controller

import (
	"bytes"
	"io"
	"mime/multipart"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRewriteMultipartModelPreservesAudioAndOtherFields(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("model", "public-asr"))
	require.NoError(t, writer.WriteField("language", "zh"))
	file, err := writer.CreateFormFile("file", "sample.wav")
	require.NoError(t, err)
	audio := []byte{0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x10}
	_, err = file.Write(audio)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	rewritten, contentType, err := rewriteMultipartModel(body.Bytes(), writer.FormDataContentType(), "provider-asr")
	require.NoError(t, err)

	reader := multipart.NewReader(bytes.NewReader(rewritten), writer.Boundary())
	fields := map[string]string{}
	var rewrittenAudio []byte
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		value, err := io.ReadAll(part)
		require.NoError(t, err)
		if part.FileName() != "" {
			require.Equal(t, "sample.wav", part.FileName())
			rewrittenAudio = value
			continue
		}
		fields[part.FormName()] = string(value)
	}

	require.Equal(t, writer.FormDataContentType(), contentType)
	require.Equal(t, "provider-asr", fields["model"])
	require.Equal(t, "zh", fields["language"])
	require.Equal(t, audio, rewrittenAudio)
}

func TestRewriteMultipartModelAddsMissingModel(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "sample.wav")
	require.NoError(t, err)
	_, err = file.Write([]byte("audio"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	rewritten, _, err := rewriteMultipartModel(body.Bytes(), writer.FormDataContentType(), "provider-asr")
	require.NoError(t, err)

	reader := multipart.NewReader(bytes.NewReader(rewritten), writer.Boundary())
	model := ""
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		if part.FormName() == "model" {
			value, err := io.ReadAll(part)
			require.NoError(t, err)
			model = string(value)
		}
	}
	require.Equal(t, "provider-asr", model)
}
