/** Installed-skill choices for the pre-Session composer. */
import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Select } from '@deepseek-ai/dsh-client-ui-primitives'
import { productText } from './locales/product.ts'

type SkillChoice = { name: string; displayName?: string }

/** Render installed skills without creating a task directory.
 * @param props - User-level catalog reader and draft-only insertion callback.
 * @returns A skill selector before Session selection.
 */
export function DraftSkillPicker({ sessionId, load, choose }: PropsRuntime<'conversation.composer.tools'> & {
  load: () => Promise<readonly SkillChoice[]>
  choose: (skill: SkillChoice) => void
}) {
  const [skills, setSkills] = useState<readonly SkillChoice[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (sessionId !== undefined) return
    let disposed = false
    const refresh = () => {
      void load().then((value) => { if (!disposed) { setSkills(value); setError('') } })
        .catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    }
    refresh()
    window.addEventListener('dsh:skills-changed', refresh)
    return () => { disposed = true; window.removeEventListener('dsh:skills-changed', refresh) }
  }, [load, sessionId])
  if (sessionId !== undefined) return null
  return <span title={error || undefined}><Select label={productText('选择技能')} value="" options={skills.map(skill => ({
    value: skill.name, label: skill.displayName ?? skill.name,
  }))} onChange={(name) => {
    const skill = skills.find(item => item.name === name)
    if (skill !== undefined) choose(skill)
  }} /></span>
}
