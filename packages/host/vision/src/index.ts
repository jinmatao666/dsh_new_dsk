/**
 * Server-governed desktop image recognition.
 *
 * `read_image` remains the native path for a currently selected visual model.
 * `recognize_image` is intentionally different: it asks OneAPI for the
 * administrator-selected visual model, then returns a textual description to
 * the current agent. Upstream keys never leave OneAPI.
 */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import { imageMediaTypeForPath, resolveRegularReadTarget } from '@deepseek-ai/dsh-tool-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024

export interface Config {
  /** OneAPI origin without `/v1`; same endpoint used by desktop sign-in. */
  baseURL: string
  /** Per-user OneAPI token held by the local credentials service. */
  credentialRef: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string().required(),
  credentialRef: z.string().default('DSH_ONEAPI_TOKEN'),
})

export const name = 'dsh-vision'
export const inject = ['tools', 'fs', 'credentials']

interface StatusEnvelope { data?: { vision_model?: unknown } }
interface DetailEnvelope {
  success?: unknown
  data?: Array<{ id?: unknown; attachment?: unknown; modalities?: { input?: unknown } }>
}
interface CompletionEnvelope { choices?: Array<{ message?: { content?: unknown } }> }

function normalizedOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('OneAPI 地址必须使用 http 或 https')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function jsonBody<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('识图服务响应过大')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`识图服务返回无效 JSON（HTTP ${String(response.status)}）`)
  }
}

/** Resolve and validate the server choice against the signed-in user's models. */
async function selectedVisionModel(baseURL: string, token: string, signal: AbortSignal): Promise<string> {
  const statusResponse = await fetch(`${baseURL}/api/status`, { signal })
  if (!statusResponse.ok) throw new Error(`无法读取视觉模型配置（HTTP ${String(statusResponse.status)}）`)
  const status = await jsonBody<StatusEnvelope>(statusResponse)
  const model = typeof status.data?.vision_model === 'string' ? status.data.vision_model.trim() : ''
  if (model === '') throw new Error('管理员尚未在后台“基础设置”中指定默认视觉模型')

  const modelsResponse = await fetch(`${baseURL}/api/user/available_models/detail`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  })
  if (!modelsResponse.ok) throw new Error(`无法校验视觉模型权限（HTTP ${String(modelsResponse.status)}）`)
  const models = await jsonBody<DetailEnvelope>(modelsResponse)
  if (models.success !== true) throw new Error('无法读取当前用户可用模型列表')
  const selected = (models.data ?? []).find(entry => entry.id === model)
  if (selected === undefined) {
    throw new Error(`默认视觉模型“${model}”未授权给当前用户；请将该模型的来源渠道分组授权给此用户`)
  }
  const imageInput = selected.attachment === true
    || (Array.isArray(selected.modalities?.input) && selected.modalities.input.includes('image'))
  if (!imageInput) {
    throw new Error(`默认视觉模型“${model}”未启用图片输入；请在后台模型定义中启用模型并勾选“支持图片输入”`)
  }
  return model
}

/** Register the server-selected vision operation. */
export function apply(ctx: Context, config: Config): void {
  const baseURL = normalizedOrigin(config.baseURL)
  const tokenRef = credentialRef(config.credentialRef)
  ctx.tools.register(defineTool({
    name: 'recognize_image',
    description: 'Use the administrator-configured vision model to recognize a local PNG/JPEG/WebP/GIF image. Returns a textual visual description, including when the current chat model is text-only.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the local image file.' },
      prompt: { type: 'string', description: 'Optional instruction, for example extract a table or describe the image.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          model: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<vision_model>${value.model}</vision_model>\n<recognition>\n${value.content}\n</recognition>`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim() === '') throw new Error('file_path must be a non-empty string')
      const mediaType = imageMediaTypeForPath(args.file_path)
      if (mediaType === undefined) throw new Error('recognize_image only accepts PNG/JPEG/WebP/GIF paths')
      const token = (await ctx.credentials.resolve(tokenRef))?.value
      if (token === undefined || token === '') throw new Error('请先登录桌面端后再使用识图')
      const { target, info } = await resolveRegularReadTarget(ctx, exec, args.file_path)
      const data = await ctx.fs.readBytes(target, exec.signal, MAX_IMAGE_BYTES)
      const model = await selectedVisionModel(baseURL, token, exec.signal)
      const prompt = typeof args.prompt === 'string' && args.prompt.trim() !== ''
        ? args.prompt.trim()
        : '请准确描述图片内容；如含文字、表格、图表或文件信息，请尽量完整提取。'
      const response = await fetch(`${baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${Buffer.from(data).toString('base64')}` } },
            ],
          }],
        }),
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(`视觉模型调用失败（HTTP ${String(response.status)}）`)
      const result = await jsonBody<CompletionEnvelope>(response)
      const content = result.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim() === '') throw new Error('视觉模型未返回可用识别结果')
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return { path: target.displayPath, model, content: content.trim() }
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Recognize image ${basename(args.file_path)}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
