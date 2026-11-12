import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API, showSuccess } from '../../helpers';

export default function KnowledgeCreditShareSettings({ onClose }) {
  const [percent, setPercent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    API.get('/api/knowledge-bases/credit-settings', { signal: abort.signal }).then(({ data }) => {
      if (!data?.success || !data.data?.enabled) throw new Error(data?.message || '当前版本未启用知识库积分');
      setPercent(String(data.data.platform_percent));
    }).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);
  const valid = percent !== null && /^\d+$/.test(percent) && Number(percent) <= 100;
  return createPortal(<div className='knowledge-quota-dialog-backdrop feature-page-dialog-backdrop'>
    <form className='knowledge-quota-dialog feature-page-dialog' role='dialog' aria-modal='true' aria-label='知识库积分设置'
      onKeyDown={event => { if (event.key === 'Escape' && !saving) onClose(); }}
      onSubmit={async event => {
        event.preventDefault();
        if (!valid || saving) return;
        setSaving(true); setError('');
        try {
          const { data } = await API.put('/api/knowledge-admin/credit-settings', { platform_percent: Number(percent) });
          if (!data?.success) throw new Error(data?.message || '保存分成失败');
          showSuccess('知识库积分分成已保存'); onClose();
        } catch (cause) { setError(cause.response?.data?.message || cause.message); }
        finally { setSaving(false); }
      }}>
      <h3>知识库积分设置</h3>
      <p className='settings-description'>平台与维护者分成仅用于运营版订阅知识库的浏览、问答和下载。</p>
      {percent !== null && <div className='settings-contact-fields'>
        <label>平台占比（%）<input type='number' min='0' max='100' step='1' required value={percent} disabled={saving}
          onChange={event => setPercent(event.target.value)} /></label>
        <p>维护者占比：{valid ? `${100 - Number(percent)}%` : '—'}</p>
      </div>}
      {error !== '' && <p role='alert' className='knowledge-quota-summary is-error'>{error}</p>}
      <footer><button type='button' className='settings-secondary' disabled={saving} onClick={onClose}>取消</button>
        <button type='submit' className='settings-primary' disabled={saving || !valid}>保存</button></footer>
    </form>
  </div>, document.body);
}
