package controller

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
)

func rewriteMultipartModel(body []byte, contentType string, modelName string) ([]byte, string, error) {
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, "", fmt.Errorf("parse content type: %w", err)
	}
	if mediaType != "multipart/form-data" {
		return nil, "", fmt.Errorf("expected multipart/form-data, got %s", mediaType)
	}
	boundary := params["boundary"]
	if boundary == "" {
		return nil, "", fmt.Errorf("multipart boundary is missing")
	}

	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	var rewritten bytes.Buffer
	writer := multipart.NewWriter(&rewritten)
	if err := writer.SetBoundary(boundary); err != nil {
		return nil, "", fmt.Errorf("set multipart boundary: %w", err)
	}

	foundModel := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, "", fmt.Errorf("read multipart part: %w", err)
		}
		destination, err := writer.CreatePart(part.Header)
		if err != nil {
			return nil, "", fmt.Errorf("create multipart part: %w", err)
		}
		if part.FormName() == "model" {
			_, err = io.WriteString(destination, modelName)
			foundModel = true
		} else {
			_, err = io.Copy(destination, part)
		}
		if err != nil {
			return nil, "", fmt.Errorf("copy multipart part %q: %w", part.FormName(), err)
		}
	}
	if !foundModel {
		if err := writer.WriteField("model", modelName); err != nil {
			return nil, "", fmt.Errorf("write multipart model: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", fmt.Errorf("close multipart writer: %w", err)
	}
	return rewritten.Bytes(), writer.FormDataContentType(), nil
}
