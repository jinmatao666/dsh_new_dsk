import React, { useState } from 'react';

export const FEATURE_PAGE_ENTRIES = [
  ['landMarket', '土地市场'],
  ['policyEncyclopedia', '政策宝典'],
];

export const defaultFeaturePages = {
  landMarket: { url: '' },
  policyEncyclopedia: { url: '' },
};

/** Normalize stored page URLs; missing entries become empty strings.
 * @param {unknown} value
 * @returns {{ landMarket: { url: string }, policyEncyclopedia: { url: string } }}
 */
export function normalizeFeaturePages(value) {
  const source = value && typeof value === 'object' ? value : {};
  const next = { ...defaultFeaturePages };
  for (const [key] of FEATURE_PAGE_ENTRIES) {
    const entry = source[key];
    const url = entry && typeof entry === 'object' && typeof entry.url === 'string' ? entry.url.trim() : '';
    next[key] = { url };
  }
  return next;
}

/** Validate one configured page URL before save.
 * @param {string} url
 * @returns {string} empty when valid, otherwise a Chinese error message
 */
export function validateFeaturePageUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2048) return '页面地址过长，请缩短后再保存';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '请输入有效的 http 或 https 地址';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '请输入有效的 http 或 https 地址';
  }
  if (!parsed.host) return '请输入有效的 http 或 https 地址';
  return '';
}

/** List configured portal pages and edit each URL in a dialog.
 * @param {{ value: typeof defaultFeaturePages, disabled?: boolean, onChange: (value: typeof defaultFeaturePages) => void }} props
 */
export default function FeaturePagesSettings({ value, disabled, onChange }) {
  const pages = normalizeFeaturePages(value);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const open = key => {
    setEditing(key);
    setDraft(pages[key]?.url || '');
    setError('');
  };

  const close = () => {
    setEditing(null);
    setDraft('');
    setError('');
  };

  const confirm = () => {
    const message = validateFeaturePageUrl(draft);
    if (message) {
      setError(message);
      return;
    }
    onChange(normalizeFeaturePages({
      ...pages,
      [editing]: { url: draft.trim() },
    }));
    close();
  };

  const label = FEATURE_PAGE_ENTRIES.find(([key]) => key === editing)?.[1] || '';

  return <>
    <table className='settings-features'>
      <thead>
        <tr>
          <th scope='col'>功能</th>
          <th scope='col'>页面地址</th>
          <th scope='col'>操作</th>
        </tr>
      </thead>
      <tbody>
        {FEATURE_PAGE_ENTRIES.map(([key, name]) => {
          const url = pages[key]?.url || '';
          return <tr key={key}>
            <th scope='row'>{name}</th>
            <td><span className='feature-page-url' title={url || undefined}>{url || '未配置'}</span></td>
            <td>
              <button type='button' className='settings-secondary knowledge-quota-configure'
                disabled={disabled} onClick={() => open(key)}>配置</button>
            </td>
          </tr>;
        })}
      </tbody>
    </table>
    {editing && <div className='knowledge-quota-dialog-backdrop'>
      <section className='knowledge-quota-dialog feature-page-dialog' role='dialog' aria-modal='true' aria-label={`配置${label}`}>
        <header>
          <h3>配置{label}</h3>
          <button type='button' className='settings-secondary' onClick={close}>关闭</button>
        </header>
        <label className='feature-page-url-field'>
          页面地址
          <input aria-label={`${label}页面地址`} value={draft} maxLength={2048} disabled={disabled}
            placeholder='例如 https://land.example/#/home'
            onChange={event => { setDraft(event.target.value); setError(''); }} />
        </label>
        <p className='settings-description'>保存后，桌面端开启该入口时将展示此页面。留空表示尚未配置地址。</p>
        {error && <p role='alert' className='knowledge-quota-summary is-error'>{error}</p>}
        <footer>
          <button type='button' className='settings-secondary' onClick={close}>取消</button>
          <button type='button' className='settings-primary' disabled={disabled} onClick={confirm}>确定</button>
        </footer>
      </section>
    </div>}
  </>;
}
