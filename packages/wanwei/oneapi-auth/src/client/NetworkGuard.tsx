import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { internalLink, type NetworkState } from '../network-contract.ts'

export interface NetworkInjected { hooks: { network: HostObservable<NetworkState> } }
/** Guard chat links without changing local-file or internal-service links. */
export function NetworkGuard({ useNetwork, t }: PropsRuntime<'shell.overlay'> & InjectFace<NetworkInjected> & PropsLocale<'wanwei.auth'>) {
  const network = useNetwork(value => value)
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const show = () => { setNotice(true); clearTimeout(timer); timer = setTimeout(() => { setNotice(false) }, 3000) }
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(element instanceof HTMLAnchorElement) || network.mode !== 'intranet') return
      if (!/^https?:/i.test(element.href) || internalLink(element.href, network.internalOrigins)) return
      event.preventDefault(); event.stopImmediatePropagation(); show()
    }
    document.addEventListener('click', click, true)
    document.addEventListener('auxclick', click, true)
    window.addEventListener('wanwei:network-blocked', show)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', click, true)
      document.removeEventListener('auxclick', click, true)
      window.removeEventListener('wanwei:network-blocked', show)
    }
  }, [network])
  return notice ? <div role="status" style={{ position: 'fixed', zIndex: 20000, top: 24, left: '50%', transform: 'translateX(-50%)', background: '#fff', color: '#343a40', border: '1px solid #e1e4e8', borderRadius: 8, padding: '12px 18px', boxShadow: '0 4px 16px #00000014', fontSize: 14 }}>{t('networkUnavailable')}</div> : null
}
