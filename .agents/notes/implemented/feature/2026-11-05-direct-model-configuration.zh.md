# Agent Note: 直接配置模型与草稿测试

Status: implemented

[English](2026-11-05-direct-model-configuration.md) | 中文

## Problem

输入框需要二次点击才能进入模型列表，自定义模型创建时还需额外添加模型行，桌面用户同时面临内部路由标识。

## Decision

模型按钮直接展开模型列表，列表内保留推理等级入口。桌面自定义模型表单默认显示一组模型名称与别名，随后为URL和密钥。模型名称作为请求ID，高级设置默认收起，协议默认OpenAI completions。内部提供方标识自动生成并保持稳定。

testModel远程方法由后台使用未保存的表单值测试，不写入配置或凭证。支持OpenAI completions/responses和Anthropic messages，保留路径前缀，拒绝重定向，支持取消并在30秒后超时。错误正文和凭证不回显。修改表单后清除旧测试结果。保存按钮与写入处理均要求当前草稿测试通过，包括仅重试写入密钥的情况。

## Alternatives considered

模型列表获取无法验证聊天端点及所选模型；浏览器直接请求依赖上游CORS许可。

## Consequences

测试会产生一次模型请求，仅验证当前草稿端点，不保存配置或证明全部模型能力。其他协议仍可配置，但测试明确拒绝尚未支持的协议。
