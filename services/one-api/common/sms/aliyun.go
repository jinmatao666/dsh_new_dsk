package sms

import (
	"encoding/json"
	"errors"
	"fmt"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	dysmsapi "github.com/alibabacloud-go/dysmsapi-20170525/v3/client"
	"github.com/alibabacloud-go/tea/tea"
)

type AliyunProvider struct {
	client       *dysmsapi.Client
	signName     string
	templateCode string
}

func NewAliyunProvider(accessKeyId, accessKeySecret, signName, templateCode, region string) (*AliyunProvider, error) {
	if accessKeyId == "" || accessKeySecret == "" {
		return nil, errors.New("aliyun SMS credentials are not configured")
	}

	// Aliyun SMS uses a unified global endpoint, region is not needed
	endpoint := "dysmsapi.aliyuncs.com"
	if region != "" && region != "cn-hangzhou" {
		// Only use region-specific endpoint if explicitly set to non-default region
		endpoint = fmt.Sprintf("dysmsapi.%s.aliyuncs.com", region)
	}

	config := &openapi.Config{
		AccessKeyId:     tea.String(accessKeyId),
		AccessKeySecret: tea.String(accessKeySecret),
		Endpoint:        tea.String(endpoint),
	}

	client, err := dysmsapi.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create aliyun SMS client: %w", err)
	}

	return &AliyunProvider{
		client:       client,
		signName:     signName,
		templateCode: templateCode,
	}, nil
}

func (p *AliyunProvider) SendVerificationCode(phone, code string) error {
	// Template parameters
	templateParam := map[string]string{
		"code": code,
	}
	templateParamJSON, err := json.Marshal(templateParam)
	if err != nil {
		return fmt.Errorf("failed to marshal template parameters: %w", err)
	}

	request := &dysmsapi.SendSmsRequest{
		PhoneNumbers:  tea.String(phone),
		SignName:      tea.String(p.signName),
		TemplateCode:  tea.String(p.templateCode),
		TemplateParam: tea.String(string(templateParamJSON)),
	}

	response, err := p.client.SendSms(request)
	if err != nil {
		return fmt.Errorf("failed to send SMS: %w", err)
	}

	if response.Body.Code == nil || *response.Body.Code != "OK" {
		errMsg := "unknown error"
		if response.Body.Message != nil {
			errMsg = *response.Body.Message
		}
		return fmt.Errorf("SMS sending failed: %s", errMsg)
	}

	return nil
}
