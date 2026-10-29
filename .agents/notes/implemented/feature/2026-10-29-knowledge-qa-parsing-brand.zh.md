# Agent Note: 知识库问答解析提示与品牌文案

Status: implemented

[English](2026-10-29-knowledge-qa-parsing-brand.md) | 中文

## Problem

刚上传、尚未切完的文件上发起问答时，后台返回错误而非产品回答。桌面端问答与预览问答里 logo 旁品牌仍显示「万维」。

## Decision

OneAPI 在调用 RAGFlow 完成前检查文档 `run` 状态。指定的 `document_id` 仍为等待或解析中时，HTTP 200 返回回答「文件正在解析，请稍后重试」（流式与非流式一致）。未指定文档时，仅当库内有文件、无一就绪且至少一仍在解析时返回同一提示。状态查询失败只记日志并走原完成路径。两处问答面板中 `/brand-mark.svg` 旁品牌文案为「万维Buddy」。关联问题末尾问号归属 [知识库回答耗时与关联问题](2026-10-29-knowledge-answer-timing-related.zh.md)。

## Alternatives considered

完成失败后再映射 RAGFlow 错误文案 — 否决为主要路径；文档元数据在调用前即可判断。改写所有含「万维」的产品文案 — 否决；需求仅改 logo 旁问答品牌。

## Consequences

文件尚未切片完成时，用户看到带解析提示的助手回复，而不是请求失败。解析失败或已取消的文档不视为「解析中」。欢迎语与「问问万维」文案不变。

## Required verification

上传文件后在解析完成前提问，确认得到提示回答且无错误提示；确认问答与预览问答 logo 旁显示「万维Buddy」。
