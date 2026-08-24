import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import './marketplace.css'

type Skill = { id: string; name: string; category: string; summary: string; installs: string; accent: string }
const L = {
  title: '\u6280\u80fd\u5e7f\u573a', openBrowser: '\u5728\u6d4f\u89c8\u5668\u6253\u5f00', close: '\u5173\u95ed\u6280\u80fd\u5e7f\u573a', subtitle: '\u53d1\u73b0\u53ef\u590d\u7528\u7684\u5de5\u4f5c\u6d41\u548c\u667a\u80fd\u52a9\u624b', search: '\u641c\u7d22\u6280\u80fd', all: '\u5168\u90e8', installed: '\u5df2\u5b89\u88c5', install: '\u6a21\u62df\u5b89\u88c5', count: '\u6b21\u5b89\u88c5', empty: '\u6ca1\u6709\u5339\u914d\u7684\u6280\u80fd', action: '\u6280\u80fd\u5e7f\u573a',
}
const MOCK_SKILLS: readonly Skill[] = [
  { id: 'document-review', name: '\u6587\u6863\u5ba1\u9605\u52a9\u624b', category: '\u529e\u516c\u6548\u7387', summary: '\u5feb\u901f\u63d0\u53d6\u8981\u70b9\u3001\u6807\u6ce8\u98ce\u9669\u5e76\u751f\u6210\u5ba1\u9605\u6e05\u5355\u3002', installs: '1.2k', accent: '#2563eb' },
  { id: 'land-data-helper', name: '\u5730\u7406\u6570\u636e\u52a9\u624b', category: '\u6570\u636e\u5206\u6790', summary: '\u8f85\u52a9\u6574\u7406\u5730\u7406\u6570\u636e\u3001\u5b57\u6bb5\u8bf4\u660e\u548c\u7edf\u8ba1\u4efb\u52a1\u3002', installs: '860', accent: '#0f766e' },
  { id: 'report-writer', name: '\u62a5\u544a\u7f16\u5199\u52a9\u624b', category: '\u5185\u5bb9\u521b\u4f5c', summary: '\u5c06\u6750\u6599\u6574\u7406\u4e3a\u7ed3\u6784\u5316\u6c47\u62a5\u63d0\u7eb2\u548c\u6b63\u5f0f\u62a5\u544a\u3002', installs: '2.4k', accent: '#9333ea' },
  { id: 'meeting-notes', name: '\u4f1a\u8bae\u7eaa\u8981\u52a9\u624b', category: '\u529e\u516c\u6548\u7387', summary: '\u628a\u4f1a\u8bae\u6750\u6599\u8f6c\u6362\u6210\u5f85\u529e\u4e8b\u9879\u548c\u8d23\u4efb\u5206\u5de5\u3002', installs: '730', accent: '#ea580c' },
]
type Controller = { open(): void; close(): void; subscribe(listener: (open: boolean) => void): () => void }
function createController(): Controller { const listeners = new Set<(open: boolean) => void>(); return { open: () => listeners.forEach(listener => listener(true)), close: () => listeners.forEach(listener => listener(false)), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) } } }
type OverlayProps = PropsRuntime<'shell.overlay'> & { controller: Controller; marketplaceUrl: string }
type ActionProps = PropsRuntime<'sidebar.footer.action'> & SidebarFooterActionOwnerProps & { controller: Controller }
function SkillMarketplace({ controller, marketplaceUrl }: OverlayProps) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [category, setCategory] = useState(L.all)
  const [installed, setInstalled] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('dsh.mock.skills') ?? '[]') as string[]) } catch { return new Set() } })
  useEffect(() => controller.subscribe(next => setOpen(next)), [controller]); if (!open) return null
  const categories = [L.all, ...new Set(MOCK_SKILLS.map(skill => skill.category))]
  const visible = MOCK_SKILLS.filter(skill => (category === L.all || skill.category === category) && (query.trim() === '' || `${skill.name} ${skill.summary}`.toLowerCase().includes(query.trim().toLowerCase())))
  const install = (id: string) => { const next = new Set(installed); next.has(id) ? next.delete(id) : next.add(id); setInstalled(next); localStorage.setItem('dsh.mock.skills', JSON.stringify([...next])) }
  return <div className="dsh-skill-market-overlay" role="dialog" aria-modal="true" aria-label={L.title}><div className="dsh-skill-market-panel">
    <header className="dsh-skill-market-header"><div><span className="dsh-skill-kicker">ZJUGIS HARNESS</span><h1>{L.title}</h1><p>{L.subtitle}</p></div><div className="dsh-skill-market-actions"><a href={marketplaceUrl} target="_blank" rel="noreferrer">{L.openBrowser}</a><button type="button" aria-label={L.close} onClick={() => { setOpen(false); controller.close() }}>×</button></div></header>
    <div className="dsh-skill-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={L.search} /><div className="dsh-skill-categories">{categories.map(item => <button key={item} type="button" className={item === category ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    <div className="dsh-skill-grid">{visible.map(skill => <article className="dsh-skill-card" key={skill.id}><div className="dsh-skill-card-icon" style={{ background: skill.accent }}>{skill.name.slice(0, 1)}</div><div className="dsh-skill-card-body"><div className="dsh-skill-card-meta"><span>{skill.category}</span><small>{skill.installs} {L.count}</small></div><h2>{skill.name}</h2><p>{skill.summary}</p><button type="button" onClick={() => install(skill.id)} className={installed.has(skill.id) ? 'installed' : ''}>{installed.has(skill.id) ? L.installed : L.install}</button></div></article>)}</div>
    {visible.length === 0 && <div className="dsh-skill-empty">{L.empty}</div>}
  </div></div>
}
function SkillMarketplaceAction({ wide, controller }: ActionProps) { return <button type="button" className={`dsh-skill-market-action${wide ? '' : ' rail'}`} aria-label={L.action} onClick={() => controller.open()}><span aria-hidden="true">✦</span>{wide && <span>{L.action}</span>}</button> }
export const inject = ['slots']
export function apply(ctx: ClientContext): void { const controller = createController(); const marketplaceUrl = (process.env.DSH_CLIENT_SKILL_MARKETPLACE_URL ?? 'https://skills.zjugis.com/').trim(); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'skill-marketplace', order: 10, inject: () => ({ controller }) }, SkillMarketplaceAction)); ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'skill-marketplace', order: 100, inject: () => ({ controller, marketplaceUrl }) }, SkillMarketplace)) }
