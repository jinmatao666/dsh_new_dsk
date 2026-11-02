import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthView } from './controller.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ManagedProviderCatalog.module.css'

type Props = PropsRuntime<'settings.models.provider-card'>
  & InjectFace<{ hooks: { auth: HostObservable<AuthView> } }>
  & PropsLocale<'wanwei.auth'>

/** Show the server catalog inside its read-only provider row. */
export function ManagedProviderCatalog({ provider, useAuth, t }: Props) {
  const auth = useAuth(view => view)
  if (provider.provider !== 'dsh-server') return null
  const models = auth.state === 'authenticated' ? auth.models : []
  return models.length > 0
    ? <ul className={css.models}>{models.map(model => <li key={model}>{model}</li>)}</ul>
    : <p className={css.empty}>{auth.state === 'checking' ? t('checking') : t('noModels')}</p>
}
