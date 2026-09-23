// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AuthView } from '../src/client/controller.ts'
import { ManagedModelsSection } from '../src/client/ManagedModelsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t: Parameters<typeof ManagedModelsSection>[0]['t'] = makeTranslate(zh, commonZh)

function renderModels(auth: AuthView): void {
  const useAuth = <Selected,>(selector: (state: AuthView) => Selected): Selected => selector(auth)
  render(<ManagedModelsSection useAuth={useAuth} logout={async () => ({ state: 'logged-out' })} t={t} />)
}

describe('Wanwei managed model settings', () => {
  it('shows only the server-authorized catalog without local provider controls', () => {
    renderModels({ state: 'authenticated', username: 'tester', models: ['qwen3.8-27b-fp8', 'kimi-k3'] })
    expect(screen.getByText('Model Server')).toBeTruthy()
    expect(screen.getByText('qwen3.8-27b-fp8')).toBeTruthy()
    expect(screen.getByText('kimi-k3')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does not show stale models while signed out', () => {
    renderModels({ state: 'logged-out' })
    expect(screen.getByText(zh.noModels)).toBeTruthy()
  })
})
