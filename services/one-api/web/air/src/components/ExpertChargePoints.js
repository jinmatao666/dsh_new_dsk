import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { API, copy as copyText, showError, showSuccess } from '../helpers';
import './ExpertChargePoints.css';

const empty = () => ({ name: '', description: '', credits: '0', enabled: true });

export default function ExpertChargePoints({ expert, kind = 'expert', onClose }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null);
  const [deletePoint, setDeletePoint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const dialog = useRef(null);
  const editor = useRef(null);
  const base = `/api/billing/v1/resources/${kind}/${encodeURIComponent(expert.key)}/charge-points`;
  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await API.get(base);
      if (!result.data?.success) throw new Error(result.data?.message || '读取扣分点失败');
      setItems(result.data.data || []);
    } catch (error) {
      setLoadError(true);
      showError(error.response?.data?.message || error.message || '读取扣分点失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    if (!draft && !deletePoint) return;
    const previous = document.activeElement;
    editor.current?.querySelector(draft ? 'input' : 'button')?.focus();
    return () => previous?.focus?.();
  }, [Boolean(draft), Boolean(deletePoint)]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    try {
      const result = await API.delete(`${base}/${encodeURIComponent(deletePoint.id)}`, { data: { version: deletePoint.version } });
      if (!result.data?.success) throw new Error(result.data?.message || '删除失败');
      setDeletePoint(null);
      showSuccess('扣分点已删除');
      await load();
    } catch (error) { showError(error.response?.data?.message || error.message || '删除失败'); }
    finally { lock.current = false; setSaving(false); }
  };
  const save = async event => {
    event.preventDefault();
    if (lock.current) return;
    const credits = String(draft.credits).trim();
    if (!draft.name.trim() || !/^\d+(\.\d+)?$/.test(credits) || !Number.isFinite(Number(credits)) || Number(credits) > 1000000) {
      showError('请填写扣分点名称和 0～1000000 之间的积分'); return;
    }
    lock.current = true;
    setSaving(true);
    try {
      const payload = { name: draft.name.trim(), description: draft.description.trim(), credits, enabled: draft.enabled, version: draft.version || 0 };
      const result = draft.id ? await API.put(`${base}/${encodeURIComponent(draft.id)}`, payload) : await API.post(base, payload);
      if (!result.data?.success) throw new Error(result.data?.message || '保存失败');
      setDraft(null);
      showSuccess('扣分点已保存');
      await load();
    } catch (error) { showError(error.response?.data?.message || error.message || '保存失败'); }
    finally { lock.current = false; setSaving(false); }
  };
  const copy = async value => {
    try {
      if (!await copyText(value)) throw new Error('copy failed');
      showSuccess('扣分点 ID 已复制');
    }
    catch { showError('复制失败，请选中 ID 手动复制'); }
  };
  const keyDown = event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!saving) { if (deletePoint) setDeletePoint(null); else if (draft) setDraft(null); else onClose(); } }
    if (event.key !== 'Tab') return;
    const activeDialog = draft || deletePoint ? editor.current : dialog.current;
    const nodes = [...activeDialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === activeDialog)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <><div className='expert-web-backdrop'>
    <section ref={dialog} tabIndex={-1} className='expert-charge-dialog' role='dialog' aria-modal={draft || deletePoint ? undefined : 'true'} aria-hidden={draft || deletePoint ? true : undefined} inert={draft || deletePoint ? '' : undefined} aria-labelledby='charge-title' onKeyDown={keyDown}>
      <header><div><h2 id='charge-title'>积分</h2><p>{expert.name} <span>· {expert.key}</span></p></div><button type='button' aria-label='关闭积分' disabled={saving} onClick={onClose}>×</button></header>
      <div className='expert-charge-body'>
        <div className='expert-charge-toolbar'><p>为不同业务配置扣分点，开发时使用固定 ID 接入。</p><button className='primary' type='button' disabled={saving || loading || loadError || Boolean(draft)} onClick={() => setDraft(empty())}>＋ 添加扣分点</button></div>
        {loading ? <p role='status'>正在读取扣分点…</p> : loadError ? <div role='alert'>读取失败，请重试。<button type='button' onClick={() => void load()}>重新加载</button></div> : <>
          {!items.length && !draft && <div className='expert-charge-empty'><strong>还没有扣分点</strong><p>添加业务名称和积分，保存后即可获得接入 ID。</p></div>}
          <div className='expert-charge-list'>{items.map(item => <article key={item.id}>
            <div className='expert-charge-row'><strong>{item.name}</strong><span className={item.enabled ? 'charge-enabled' : 'charge-disabled'}>{item.enabled ? '已启用' : '已停用'}</span><b>{item.credits}<small> 积分／次</small></b><button type='button' disabled={saving || Boolean(draft)} onClick={() => setDraft({ ...item, credits: String(item.credits) })}>配置</button></div>
            {item.description && <p>{item.description}</p>}
            <div className='expert-charge-id'><code>{item.id}</code><button type='button' onClick={() => void copy(item.id)}>复制 ID</button><button className='charge-delete' type='button' disabled={saving || Boolean(draft) || Boolean(deletePoint)} onClick={() => setDeletePoint(item)}>删除</button></div>
          </article>)}</div>
        </>}

      </div>
      <footer><span>调价仅影响新任务，已预留任务沿用原价。</span><button type='button' disabled={saving} onClick={onClose}>完成</button></footer>
    </section>
  </div>
    {draft && createPortal(<div className='expert-web-backdrop expert-charge-editor-backdrop'>
      <section ref={editor} tabIndex={-1} className='expert-charge-dialog expert-charge-editor' role='dialog' aria-modal='true' aria-labelledby='charge-editor-title' onKeyDown={keyDown}>
        <header><div><h2 id='charge-editor-title'>{draft.id ? '编辑扣分点' : '添加扣分点'}</h2><p>{expert.name}</p></div><button type='button' aria-label='关闭扣分点编辑' disabled={saving} onClick={() => setDraft(null)}>×</button></header>
        <form className='expert-charge-form' onSubmit={save}>
          {draft.id && <div className='expert-charge-id'><code>{draft.id}</code><span>ID 固定不变</span></div>}
          <div className='expert-charge-fields'>
            <label>扣分点名称<input autoFocus required maxLength={100} disabled={saving} placeholder='例如：生成分析报告' value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label>消耗积分（积分／次）<input required type='number' min='0' max='1000000' step='any' disabled={saving} value={draft.credits} onChange={event => setDraft({ ...draft, credits: event.target.value })} /></label>
            <label className='charge-wide'>业务说明<textarea maxLength={500} disabled={saving} placeholder='说明在什么业务步骤调用此扣分点' value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          </div>
          <label className='expert-charge-toggle'><input type='checkbox' disabled={saving} checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />启用此扣分点</label>
          <p className='expert-charge-hint'>0 积分表示免费。停用后免费执行，不影响业务；已有预留任务仍按原价结算。</p>
          <div className='expert-charge-form-actions'><button type='button' disabled={saving} onClick={() => setDraft(null)}>取消</button><button className='primary' type='submit' disabled={saving}>{saving ? '保存中…' : '保存扣分点'}</button></div>
        </form>
      </section>
    </div>, document.body)}
    {deletePoint && createPortal(<div className='expert-web-backdrop expert-charge-editor-backdrop'>
      <section ref={editor} tabIndex={-1} className='expert-charge-dialog expert-charge-editor' role='dialog' aria-modal='true' aria-labelledby='charge-delete-title' onKeyDown={keyDown}>
        <header><h2 id='charge-delete-title'>删除扣分点</h2><button type='button' aria-label='关闭删除确认' disabled={saving} onClick={() => setDeletePoint(null)}>×</button></header>
        <div className='expert-charge-body'>确定删除「{deletePoint.name}」？删除后不再显示，已接入此 ID 的调用按 0 积分执行。历史记录保留，已预留任务仍按原价结算。</div>
        <footer><button type='button' disabled={saving} onClick={() => setDeletePoint(null)}>取消</button><button className='charge-delete' type='button' disabled={saving} onClick={() => void remove()}>{saving ? '删除中…' : '确认删除'}</button></footer>
      </section>
    </div>, document.body)}
  </>;
}
