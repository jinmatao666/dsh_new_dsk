/**
 * Send one short model request without persisting configuration or credentials.
 * @param baseURL - HTTP(S) API base address, including proxy prefixes.
 * @param api - selected wire protocol.
 * @param model - exact request model name.
 * @param apiKey - optional one-shot credential.
 * @param signal - cancellation of this test request.
 * @returns resolves after a model response, rejects on transport/protocol failure.
 */
export async function testDraftModel(
  baseURL: string, api: string, model: string, apiKey: string, signal: AbortSignal,
): Promise<void> {
  const url = new URL(baseURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTP(S) API base URL without credentials, query or fragment.')
  }
  if (model.trim().length === 0) throw new Error('Enter the model name before testing.')
  const messages = [{ role: 'user', content: 'Reply OK.' }]
  let path: string
  let body: Record<string, unknown>
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (api === 'anthropic-messages') {
    path = 'messages'
    body = { model, messages, max_tokens: 64, stream: false }
    headers['anthropic-version'] = '2023-06-01'
    if (apiKey) headers['x-api-key'] = apiKey
  } else if (api === 'openai-completions' || api === 'openai-responses') {
    path = api === 'openai-responses' ? 'responses' : 'chat/completions'
    body = api === 'openai-responses'
      ? { model, input: 'Reply OK.', stream: false }
      : { model, messages, stream: false }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  } else {
    throw new Error('Testing is supported for OpenAI completions/responses and Anthropic messages.')
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Model test failed (HTTP ${response.status}). Check the URL, protocol, model name and API key.`)
  }
  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null) throw new Error('The endpoint did not return a model response.')
  const data = result as Record<string, unknown>
  const output = api === 'anthropic-messages' ? data.content
    : api === 'openai-responses' ? data.output : data.choices
  if (!Array.isArray(output) || output.length === 0 || data.error) {
    throw new Error('The endpoint returned no model response. Check the URL, protocol and model name.')
  }
}
