import type { AccountSectionProps } from './AccountSection.tsx'
import css from './ManagedModelsSection.module.css'

/** Read-only view of the models granted by the organization server. */
export function ManagedModelsSection({ useAuth, t }: AccountSectionProps) {
  const auth = useAuth(view => view)
  const models = auth.state === 'authenticated' ? auth.models : []
  return (
    <section className={css.section}>
      <h1>{t('managedModelsTitle')}</h1>
      <p className={css.hint}>{t('managedModelsHint')}</p>
      <div className={css.provider}>
        <div className={css.providerHeading}>
          <strong>{t('managedProviderName')}</strong>
          <span>{t('managedModelsAvailable')}</span>
        </div>
        {models.length > 0
          ? <ul className={css.models}>{models.map(model => <li key={model}>{model}</li>)}</ul>
          : <p className={css.empty}>{auth.state === 'checking' ? t('checking') : t('noModels')}</p>}
      </div>
    </section>
  )
}
