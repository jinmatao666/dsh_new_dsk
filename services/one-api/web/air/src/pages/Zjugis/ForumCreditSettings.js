import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API, showSuccess } from '../../helpers';

/** Edit forum prices; embedded saves keep the address dialog and its draft open. */
export default function ForumCreditSettings({ onClose, embedded = false, disabled = false, onBusyChange }) {
  const [prices, setPrices] = useState({ qa: { credits: '1', version: 0 }, report: { credits: '1', version: 0 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    API.get('/api/portal/planning-lecture/admin/credits').then(({ data }) => {
      if (cancelled) return;
      if (!data.success || !data.data?.qa || !data.data?.report) throw new Error(data.message || '读取讲坛积分配置失败');
      setPrices(Object.fromEntries(['qa', 'report'].map(key => [key, { ...data.data[key], credits: String(data.data[key].credits) }])));
    }).catch(err => { if (!cancelled) setError(err.response?.data?.message || err.message || '读取讲坛积分配置失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);
  const save = async () => {
    if (disabled || loading || saving || Object.values(prices).some(point => point.version < 1)) return;
    if (Object.values(prices).some(point => !/^[0-9]+(?:\.[0-9]+)?$/.test(point.credits) || Number(point.credits) > 1000)) {
      setError('请输入 0 到 1000 之间的积分数');
      return;
    }
    setSaving(true);
    onBusyChange?.(true);
    setError('');
    try {
      const { data } = await API.put('/api/portal/planning-lecture/admin/credits', prices);
      if (!data.success) throw new Error(data.message || '保存讲坛积分配置失败');
      showSuccess('资规讲坛积分配置已保存');
      if (embedded) setReload(value => value + 1);
      else onClose();
    } catch (err) {
      setError(err.response?.data?.code === 'PRICE_CHANGED' ? '配置已被修改，请重新加载后再保存' : err.response?.data?.message || err.message || '保存失败');
    } finally { setSaving(false); onBusyChange?.(false); }
  };
  const content = <>
      {embedded ? <h4 className='feature-page-credential-title'>积分配置</h4> : <header><h3>资规讲坛积分配置</h3><button type='button' className='settings-secondary' disabled={saving} onClick={onClose}>关闭</button></header>}
      <div className='forum-credit-fields'>
      {['qa', 'report'].map(key => <label key={key} className='feature-page-url-field'>{key === 'qa' ? '弹框问答（积分 / 次）' : '生成报告（积分 / 次）'}
        <input type='number' min='0' max='1000' step='any' value={prices[key].credits} disabled={disabled || loading || saving}
          aria-label={key === 'qa' ? '弹框问答积分' : '生成报告积分'}
          onChange={event => setPrices({ ...prices, [key]: { ...prices[key], credits: event.target.value } })} />
      </label>)}
      </div>
      <p className='settings-description'>默认各 1 积分，设为 0 表示免费。点击「保存积分配置」后立即生效。</p>
      <p className='settings-description'>同一用户对同一篇文章或报告提出相同问题，成功后复用原答案，不重复计费。失败或取消退回预扣积分；问答和生成报告分别计费。</p>
      {loading && <p role='status'>正在加载…</p>}
      {error && <p role='alert' className='knowledge-quota-summary is-error'>{error} <button type='button' disabled={disabled || saving} onClick={() => setReload(reload + 1)}>重新加载</button></p>}
      <div className='forum-credit-actions'>{!embedded && <button type='button' className='settings-secondary' disabled={saving} onClick={onClose}>取消</button>}
        <button type='button' className='settings-primary' disabled={disabled || loading || saving || Object.values(prices).some(point => point.version < 1)} onClick={() => void save()}>{saving ? '保存中…' : '保存积分配置'}</button></div>
    </>;
  if (embedded) return <section className='feature-page-credential forum-credit-settings' aria-label='资规讲坛积分配置'>{content}</section>;
  return createPortal(<div className='knowledge-quota-dialog-backdrop feature-page-dialog-backdrop' role='presentation'>
    <section className='knowledge-quota-dialog feature-page-dialog' role='dialog' aria-modal='true' aria-label='资规讲坛积分配置'
      onKeyDown={event => { if (event.key === 'Escape' && !saving) { event.stopPropagation(); onClose(); } }}>
      {content}
    </section>
  </div>, document.body);
}
