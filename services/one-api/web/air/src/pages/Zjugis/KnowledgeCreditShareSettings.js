import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API, showSuccess } from '../../helpers';

const fields = [['question_cents', '问答最高积分'], ['download_cents', '下载最高积分'], ['browse_cents', '浏览最高积分']];
const validLimit = value => /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 1000000;

export default function KnowledgeCreditShareSettings({ onClose }) {
  const [percent, setPercent] = useState(null);
  const [limits, setLimits] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    API.get('/api/knowledge-bases/credit-settings', { signal: abort.signal }).then(({ data }) => {
      if (!data?.success || !data.data?.enabled) throw new Error(data?.message || '当前版本未启用知识库积分');
      setPercent(String(data.data.platform_percent));
      setLimits(Object.fromEntries(fields.map(([key]) => [key, String(data.data.limits[key] / 100)])));
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);
  const valid = percent !== null && /^\d+$/.test(percent) && Number(percent) <= 100;
  const validLimits = fields.every(([key]) => validLimit(limits[key] ?? ''));
  return createPortal(<div className='knowledge-quota-dialog-backdrop feature-page-dialog-backdrop'>
    <form className='knowledge-quota-dialog feature-page-dialog' role='dialog' aria-modal='true' aria-label='知识库积分设置'
      onKeyDown={event => { if (event.key === 'Escape' && !saving) onClose(); }}
      onSubmit={async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!valid || !validLimits || saving) return;
        setSaving(true); setError('');
        try {
          const { data } = await API.put('/api/knowledge-admin/credit-settings', {
            platform_percent: Number(percent),
            limits: Object.fromEntries(fields.map(([key]) => [key, Math.round(Number(limits[key]) * 100)])),
          });
          if (!data?.success) throw new Error(data?.message || '保存分成失败');
          showSuccess('知识库积分设置已保存'); onClose();
        } catch (cause) { setError(cause.response?.data?.message || cause.message); }
        finally { setSaving(false); }
      }}>
      <h3>知识库积分设置</h3>
      <p className='settings-description'>平台与维护者分成仅用于运营版订阅知识库的浏览、问答和下载。</p>
      {percent !== null && <div className='settings-contact-fields'>
        <label>平台占比（%）<input type='number' min='0' max='100' step='1' required value={percent} disabled={saving}
          onChange={event => setPercent(event.target.value)} /></label>
        <p>维护者占比：{valid ? `${100 - Number(percent)}%` : '—'}</p>
        {fields.map(([key, label]) => <label key={key}>{label}（每文件）
          <input type='number' min='0' max='1000000' step='0.01' required value={limits[key] ?? ''} disabled={saving}
            onChange={event => setLimits(current => ({ ...current, [key]: event.target.value }))} />
        </label>)}
      </div>}
      {error !== '' && <p role='alert' className='knowledge-quota-summary is-error'>{error}</p>}
      <footer><button type='button' className='settings-secondary' disabled={saving} onClick={onClose}>取消</button>
        <button type='submit' className='settings-primary' disabled={saving || !valid || !validLimits}>保存</button></footer>
    </form>
  </div>, document.body);
}
