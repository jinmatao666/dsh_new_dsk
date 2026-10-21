/** Permission selection before a Session exists, using the same confirmation UI. */
import { useEffect, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PermissionSelect as PermissionValue } from '@deepseek-ai/dsh-permission-presets/client'
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { PermissionSelect } from './PermissionSelect.tsx'

/** Render configured permission choices without creating a Workspace.
 * @param props - Root catalog read and pending-choice writer.
 * @returns The normal permission selector only for pre-Session drafts.
 */
export function DraftPermission({ sessionId, load, choose, useSubmission, t }: PropsRuntime<'conversation.composer.tools'>
  & PropsLocale<'conversation'> & InjectFace<{
    load: () => Promise<PermissionValue | null>
    choose: (value: string) => void
    hooks: { submission: ObservableSnapshot<{ busy: boolean }> }
  }>) {
  const busy = useSubmission(value => value.busy)
  const [value, setValue] = useState<PermissionValue>()
  useEffect(() => {
    if (sessionId !== undefined) return
    let disposed = false
    void load().then((result) => {
      if (!disposed && result !== null) setValue(result)
    }).catch(() => { /* A failed read cannot invent deployment permission choices. */ })
    return () => { disposed = true }
  }, [load, sessionId])
  if (sessionId !== undefined) return null
  return <PermissionSelect value={value} locked={busy} t={t} command={(line) => {
    const selected = line.slice('/permission '.length)
    if (!value?.options.some(option => option.value === selected)) return Promise.resolve(false)
    choose(selected)
    setValue({ ...value, currentValue: selected })
    return Promise.resolve(true)
  }} />
}
