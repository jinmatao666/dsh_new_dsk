/** Administrator-governed OneAPI web search for the Wanwei desktop profile. */
import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Search provider ID selected by the Wanwei desktop bundle. */
export const ONEAPI_BAILIAN_PROVIDER_ID = 'oneapi-bailian'

const CITATION_GUIDANCE = [
  '网页搜索返回的是候选网页，不代表已核实正文。回答前先用 web_fetch 或可用的浏览器工具读取具体原文，逐条核对事实、事件日期和发布日期。',
  '在每条相关事实或结论的正文末尾先用句号、问号或叹号等句末标点结束，再留一个空格并添加“来源：”及可点击的原文链接，格式为 正文。 来源：[网页真实标题](原文URL)。不要将链接直接紧贴正文，也不要用 source、源网站或只有编号的引用代替“来源：”。链接文字使用检索或实际页面返回的原始标题，不得编造标题。没有真实标题时显示可点击的原文 URL，格式为 正文。 来源：[原文URL](原文URL)，不猜测标题。多条信息逐条附上对应来源；同一条有多个来源时用顿号分隔链接。',
  '链接只能来自本次或后续检索、网页读取工具实际返回的 URL；不能猜测或拼接网址，不能用站点首页或无关网页支撑具体消息。',
  '读取失败、正文不支持结论或资料不足时，明确标注未核实或不采用该条，不得声称已验证。没有来源时明确说明未找到可核验的原文网页。',
].join('')

/** Install product-owned citation guidance independently of untrusted search content.
 * @param ctx - Host context; prompt registration follows its plugin lifecycle.
 */
export function installSearchCitationPolicy(ctx: Context): void {
  ctx.inject(['systemPrompt'], (child) => {
    child.systemPrompt.section({ name: 'wanwei:web-source-citations',
      order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 130, text: CITATION_GUIDANCE })
  })
}

interface StatusEnvelope { data?: { search_model?: unknown } }
interface CompletionEnvelope {
  search_info?: { search_results?: unknown }
  error?: { code?: unknown; message?: unknown }
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
        messages: [{ role: 'user', content: `搜索网页并整理以下问题：${request.query}。只依据检索到的资料作答，区分事件日期与发布日期。每条正文以句末标点结束，空格后添加“来源：”和真实网页标题的可点击链接，格式为 正文。 来源：[网页真实标题](原文URL)。链接必须指向支持对应信息的具体原文页面，不得编造标题、网址或用无关网页代替。` }],
      }),
      ...signalInit,
    })
    const result = await readJson(response) as CompletionEnvelope
    if (!response.ok) {
      const rawCode = result.error?.code
      const code = typeof rawCode === 'string' && /^[\w.-]{1,80}$/.test(rawCode) ? `，错误代码：${rawCode}` : ''
      const upstreamMessage = typeof result.error?.message === 'string' ? result.error.message : ''
      const reason = upstreamMessage.includes('url error') ? '模型与搜索接口不匹配。'
        : upstreamMessage.includes('Non-streaming mode does not support Web Search') ? '搜索模型要求使用流式接口。' : ''
      const guidance = response.status === 400 ? '请求被拒绝，请停止重复搜索并告知用户检查后台搜索模型与渠道配置；更换关键词不能解决接口错误。' : ''
      throw new WebError(`网页搜索失败（HTTP ${String(response.status)}${code}）。${reason}${guidance}`, 'WEB_PROVIDER_REQUEST_FAILED')
    }
    const sources = searchSources(result.search_info?.search_results)
    // Generated prose can contain invented claims and URLs even alongside genuine search results.
    // Pass retrieval metadata only; the conversation model must inspect the source pages itself.
    const citationInstruction = sources.length > 0
      ? CITATION_GUIDANCE
      : '本次搜索未返回可核验的来源链接。不要使用搜索模型生成的摘要或网址代替检索证据；请向用户明确说明未找到可核验的原文网页，不要编造标题或链接，也不要据此生成已核实的新闻或事实。'
    return { content: citationInstruction, sources, truncated: false }
  }
}
