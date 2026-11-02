// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AuthView } from '../src/client/controller.ts'
import { ManagedProviderCatalog } from '../src/client/ManagedProviderCatalog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function renderCatalog(auth: AuthView, provider = 'dsh-server') {
  const useAuth = <Selected,>(selector: (state: AuthView) => Selected): Selected => selector(auth)
  const unusedHook = (): never => { throw new Error('Catalog must not use session or workspace state') }
  const props = { provider: { provider, displayName: provider, settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', provider], active: true }, configured: true, keyConfigured: true,
  useAuth, t: makeTranslate(zh, commonZh), useSessions: unusedHook,
  useSessionPendingInteraction: unusedHook, useWorkspaces: unusedHook }
  return render(<ManagedProviderCatalog {...props} />)
}

describe('Wanwei managed provider catalog', () => {
  it('shows only the models allowed by the signed-in server account', () => {
    renderCatalog({ state: 'authenticated', username: 'tester', models: ['qwen3.8-27b-fp8', 'kimi-k3'] })
    expect(screen.getByText('qwen3.8-27b-fp8')).toBeTruthy()
    expect(screen.getByText('kimi-k3')).toBeTruthy()
  })

  it('does not show stale models after logout or under a local provider', () => {
    renderCatalog({ state: 'logged-out' })
    expect(screen.getByText(zh.noModels)).toBeTruthy()
    cleanup()
    renderCatalog({ state: 'authenticated', username: 'tester', models: ['kimi-k3'] }, 'local-route')
    expect(screen.queryByText('kimi-k3')).toBeNull()
  })
})
