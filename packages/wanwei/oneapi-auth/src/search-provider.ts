/** Administrator-governed OneAPI web search for the Wanwei desktop profile. */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'

/** Search provider ID selected by the Wanwei desktop bundle. */
export const ONEAPI_BAILIAN_PROVIDER_ID = 'oneapi-bailian'

interface StatusEnvelope { data?: { search_model?: unknown } }
interface CompletionEnvelope { choices?: Array<{ message?: { content?: unknown } }> }

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
    throw new WebError('OneAPI search response exceeded 1 MiB', 'WEB_PROVIDER_RESPONSE_INVALID')
  }
  try { return JSON.parse(text) as unknown }
  catch { throw new WebError(`OneAPI search returned invalid JSON (HTTP ${String(response.status)})`, 'WEB_PROVIDER_RESPONSE_INVALID') }
}

/** Routes web search through the administrator's OneAPI search model. */
export class OneApiSearchProvider implements WebSearchProvider {
  readonly id = ONEAPI_BAILIAN_PROVIDER_ID

  constructor(private readonly options: {
    baseURL: string
    resolveToken: () => Promise<string | undefined>
    allowed?: () => boolean
  }) {}

  available(): boolean { return this.options.allowed?.() !== false && URL.canParse(this.options.baseURL) }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (this.options.allowed?.() === false) throw new WebError('纯内网环境不可用', 'WEB_PROVIDER_UNAVAILABLE')
    const token = await this.options.resolveToken()
    if (token === undefined || token === '') throw new WebError('Sign in before using server-managed web search', 'WEB_PROVIDER_UNAVAILABLE')
    const origin = this.options.baseURL.replace(/\/+$/, '')
    const signalInit = signal === undefined ? {} : { signal }
    const statusResponse = await fetch(`${origin}/api/status`, { redirect: 'error', ...signalInit })
    if (!statusResponse.ok) throw new WebError(`Cannot read the web search model configuration (HTTP ${String(statusResponse.status)})`, 'WEB_PROVIDER_REQUEST_FAILED')
    const status = await readJson(statusResponse) as StatusEnvelope
    const model = typeof status.data?.search_model === 'string' ? status.data.search_model.trim() : ''
    if (model === '') throw new WebError('The administrator has not configured a default web search model', 'WEB_PROVIDER_UNAVAILABLE')

    const endpoint = `${origin}/v1/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-dsh-web-search': '1',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: `Search the web and summarize this query: ${request.query}` }],
      }),
      ...signalInit,
    })
    const result = await readJson(response) as CompletionEnvelope
    if (!response.ok) throw new WebError(`Web search failed (HTTP ${String(response.status)})`, 'WEB_PROVIDER_REQUEST_FAILED')
    const answer = result.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || answer.trim() === '') throw new WebError('The web search model returned no usable content', 'WEB_PROVIDER_RESPONSE_INVALID')
    return { content: answer.trim(), sources: [], truncated: false }
  }
}
