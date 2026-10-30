import { beforeEach, expect, it, vi } from 'vitest'
type Result = { exitCode: number; stdout: string; stderr: string }
const mocks = vi.hoisted(() => ({
  lark: vi.fn<(args: readonly string[], signal: AbortSignal) => Promise<Result>>(),
  dws: vi.fn<(command: string, args: readonly string[], cwd: string | undefined, signal: AbortSignal) => Promise<Result>>(),
  wechat: vi.fn<(home: string, text: string) => Promise<void>>(),
}))
vi.mock('../src/feishu-cli.ts', () => ({ runLark: mocks.lark }))
vi.mock('../src/dingtalk-dws.ts', () => ({ resolveDwsCommand: () => 'dws.exe', resolveProductDshHome: () => '/home' }))
vi.mock('../src/dingtalk-dws-tool.ts', () => ({ runDwsTool: mocks.dws }))
vi.mock('../src/wechat-ilink.ts', () => ({ sendWeChatNotification: mocks.wechat }))
import { deliverAutomationNotification } from '../src/automation-delivery.ts'
const result = (body: unknown) => ({ exitCode: 0, stdout: JSON.stringify(body), stderr: '' })
beforeEach(() => vi.resetAllMocks())
it('sends every part as the Feishu bot to the authenticated owner with stable keys', async () => {
  mocks.lark.mockImplementation(async (args: readonly string[]) => result(args[0] === 'auth'
    ? { identities: { user: { available: true, openId: 'ou_owner' } } } : { ok: true }))
  const text = '新闻🙂'.repeat(2500)
  await deliverAutomationNotification('feishu', text, 'run-1', new AbortController().signal)
  const sends = mocks.lark.mock.calls.slice(1)
  expect(sends.length).toBeGreaterThan(1)
  expect(sends.every(([args]) => args.includes('ou_owner') && args.includes('bot'))).toBe(true)
  expect(sends.every(([args]) => args[args.indexOf('--msg-type') + 1] === 'post')).toBe(true)
  const reconstructed = sends.map(([args]) => (JSON.parse(args[args.indexOf('--content') + 1] ?? '{}') as {
    zh_cn: { content: { text: string }[][] }
  }).zh_cn.content.flat().map(block => block.text).join('')).join('')
  expect(reconstructed).toBe(text)
  const key = sends[0]?.[0]
  await deliverAutomationNotification('feishu', text, 'run-1', new AbortController().signal)
  expect(mocks.lark.mock.calls[sends.length + 2]?.[0]).toEqual(key)
})
it('resolves DingTalk self by stable ID, never by ambiguous name', async () => {
  mocks.dws.mockResolvedValueOnce(result({ success: true, result: { userId: 'self-id' } }))
    .mockResolvedValueOnce(result({ success: true }))
  await deliverAutomationNotification('dingtalk', '推荐十本书', 'run-2', new AbortController().signal)
  expect(mocks.dws.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['--user', 'self-id', '--as', 'user', '--yes']))
})
it('rejects ambiguous self and business-level send failure', async () => {
  mocks.dws.mockResolvedValue(result({ success: true, result: [] }))
  await expect(deliverAutomationNotification('dingtalk', '结果', 'r', new AbortController().signal)).rejects.toThrow('本人账号')
  expect(mocks.dws).toHaveBeenCalledTimes(1)
  mocks.lark.mockResolvedValueOnce(result({ identities: { user: { available: true, openId: 'ou_me' } } }))
    .mockResolvedValueOnce(result({ ok: false }))
  await expect(deliverAutomationNotification('feishu', '结果', 'r', new AbortController().signal)).rejects.toThrow('发送成功')
})
it('uses the existing bound WeChat conversation and propagates expired context errors', async () => {
  mocks.wechat.mockRejectedValue(new Error('回复会话已过期'))
  await expect(deliverAutomationNotification('wechat', '结果', 'r', new AbortController().signal)).rejects.toThrow('过期')
  expect(mocks.wechat.mock.calls[0]?.[0]).toBe('/home')
})
