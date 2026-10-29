import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { internalLink, type NetworkState } from '../network-contract.ts'

export interface NetworkInjected { hooks: { network: HostObservable<NetworkState> } }
/** Guard chat links without changing local-file or internal-service links. */
export function NetworkGuard({ useNetwork, t }: PropsRuntime<'shell.overlay'> & InjectFace<NetworkInjected> & PropsLocale<'wanwei.auth'>) {
  const network = useNetwork(value => value)
  const [notice, setNotice] = useState<'networkUnavailable' | 'externalLinkOpenFailed'>()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const notify = (message: 'networkUnavailable' | 'externalLinkOpenFailed') => {
      setNotice(message); clearTimeout(timer); timer = setTimeout(() => { setNotice(undefined) }, 3000)
    }
    const show = () => { notify('networkUnavailable') }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button > 1) return
      const element = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(element instanceof HTMLAnchorElement) || !/^https?:/i.test(element.href)) return
      if (network.mode === 'intranet' && !internalLink(element.href, network.internalOrigins)) {
        event.preventDefault(); event.stopImmediatePropagation(); show()
        return
      }
      const native = (window as unknown as {
        __ZJUGIS_NATIVE_INVOKE__?: (command: string, args: unknown) => Promise<unknown>
      }).__ZJUGIS_NATIVE_INVOKE__
      // Open desktop citations explicitly rather than relying on WebView popup behavior.
      if (!native || element.target !== '_blank' || element.hasAttribute('download')) return
      event.preventDefault(); event.stopImmediatePropagation()
      void native('open_external_link', { address: element.href }).catch(() => { notify('externalLinkOpenFailed') })
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
  return notice ? <div role="status" style={{ position: 'fixed', zIndex: 20000, top: 24, left: '50%', transform: 'translateX(-50%)', background: '#fff', color: '#343a40', border: '1px solid #e1e4e8', borderRadius: 8, padding: '12px 18px', boxShadow: '0 4px 16px #00000014', fontSize: 14 }}>{t(notice)}</div> : null
}
