/** Administrator-governed OneAPI web search for the Wanwei desktop profile. */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Search provider ID selected by the Wanwei desktop bundle. */
export const ONEAPI_BAILIAN_PROVIDER_ID = 'oneapi-bailian'

interface StatusEnvelope { data?: { search_model?: unknown } }
interface CompletionEnvelope {
  choices?: Array<{ message?: { content?: unknown } }>
  search_info?: { search_results?: unknown }
}

function searchSources(value: unknown): WebSearchSource[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new WebError('Invalid web search sources', 'WEB_PROVIDER_RESPONSE_INVALID')
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const source = entry as Record<string, unknown>
    if (typeof source.url !== 'string' || !URL.canParse(source.url)) continue
    const url = new URL(source.url)
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') continue
    if (seen.has(url.href)) continue
    seen.add(url.href)
    sources.push({ url: url.href,
      ...typeof source.title === 'string' && source.title.trim() !== '' ? { title: source.title.trim() } : {},
    })
  }
  return sources
}

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
        messages: [{ role: 'user', content: `搜索网页并整理以下问题：${request.query}。只依据检索到的资料作答，区分事件日期与发布日期。` }],
      }),
      ...signalInit,
    })
    const result = await readJson(response) as CompletionEnvelope
    if (!response.ok) throw new WebError(`Web search failed (HTTP ${String(response.status)})`, 'WEB_PROVIDER_REQUEST_FAILED')
    const answer = result.choices?.[0]?.message?.content
    if (typeof answer !== 'string' || answer.trim() === '') throw new WebError('The web search model returned no usable content', 'WEB_PROVIDER_RESPONSE_INVALID')
    const sources = searchSources(result.search_info?.search_results)
    const citationInstruction = sources.length > 0
      ? '回答时在每条相关事实或结论旁引用下方 Sources 中对应的真实网址，使用 Markdown 链接。不要编造网址或把无来源支持的内容当成已核实事实；不要仅使用 [1] 等没有链接的编号。'
      : '本次搜索未返回可核验的来源链接。请向用户明确说明这一点，不要编造来源网址，也不要把这些内容称为已核实的新闻或事实。'
    return { content: `${answer.trim()}\n\n${citationInstruction}`, sources, truncated: false }
  }
}
