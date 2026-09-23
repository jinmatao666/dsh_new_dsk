import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-skill/client'

/** Translate the desktop installer's notification into the generic client catalog event. */
export function registerNativeSkillCatalogBridge(ctx: Context): void {
  ctx.effect(() => {
    const onChanged = () => { ctx.emit('skills/catalog-invalidated') }
    window.addEventListener('dsh:skills-changed', onChanged)
    return () => { window.removeEventListener('dsh:skills-changed', onChanged) }
  }, 'wanwei-skill-marketplace: native catalog change')
}
