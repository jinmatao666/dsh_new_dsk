/** Localized product title for a generic tool row while preserving its wire identifier. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolRowVariant } from './models/tool-call-model.ts'

/**
 * Render a Chinese-facing operation name together with the stable technical tool name.
 * @param t - conversation dictionary translator.
 * @param toolName - wire tool name.
 * @param variant - generic presentation family when the name has no dedicated label.
 * @returns the compact tool-row title.
 */
export function toolTitle(t: TranslateNS<'conversation'>, toolName: string, variant: ToolRowVariant): string {
  switch (toolName) {
    case 'bash': return t('tool.title.bash')
    case 'pwsh': return t('tool.title.pwsh')
    case 'read': return t('tool.title.read')
    case 'write': return t('tool.title.write')
    case 'edit': return t('tool.title.edit')
    case 'run_code': return t('tool.title.code')
    case 'grep': return t('tool.title.grep')
    case 'glob': return t('tool.title.glob')
    case 'web_search': return t('tool.title.webSearch')
    case 'web_fetch': return t('tool.title.webFetch')
    case 'cordis_package_inspect':
    case 'cordis_runtime_inspect': return t('tool.title.inspect')
    case 'cordis_run': return t('tool.title.cordisRun')
    case 'cordis_stop': return t('tool.title.cordisStop')
    case 'cordis_undefine': return t('tool.title.cordisRemove')
    default:
      switch (variant) {
        case 'search': return t('tool.title.search')
        case 'read': return t('tool.title.read')
        case 'bash': return t('tool.title.bash')
        case 'write': return t('tool.title.write')
        case 'edit': return t('tool.title.edit')
        case 'code': return t('tool.title.code')
        case 'others': return t('tool.title.others', { name: toolName || t('tool.unknown') })
      }
  }
}
