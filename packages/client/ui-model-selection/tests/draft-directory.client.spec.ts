import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ModelDirectory } from '../src/client/directory.ts'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'

it('selects model and effort locally before a Session exists', async () => {
  const selectModel = vi.fn()
  const catalog = new ModelCatalogDirectory({ modelCatalog: async () => ({ ok: true, value: {
    default: { provider: 'fixture', model: 'default' }, routableProviders: ['fixture'],
    groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: 'chosen', name: 'Chosen' }] }], failures: [],
  } }) } as never)
  const draft = new ModelDirectory({ selectModel }, undefined, () => true, catalog,
    createSnapshotStore<ModelSelectionProjection>({ lastUsed: null, next: null }))
  await draft.load()
  expect(draft.pendingDraftSelection).toBeNull()
  await draft.select({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
  expect(draft.store.getSnapshot().current).toEqual({ provider: 'fixture', model: 'chosen', reasoningEffort: 'high' })
  expect(draft.pendingDraftSelection).toEqual(draft.store.getSnapshot().current)
  expect(selectModel).not.toHaveBeenCalled()
  draft.dispose()
})
