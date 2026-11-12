import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API, showError, showSuccess } from '../../helpers';

export const FEATURE_PAGE_ENTRIES = [
  ['landMarket', '土地市场'],
  ['planningLecture', '资规讲坛'],
  ['policyEncyclopedia', '政策宝典'],
];

const credentialRoutes = {
  landMarket: '/api/portal/land-market',
  planningLecture: '/api/portal/planning-lecture',
};

export const defaultFeaturePages = {
  landMarket: { url: '' },
  planningLecture: { url: '' },
  policyEncyclopedia: { url: '' },
};

/** Normalize stored page URLs; missing entries become empty strings.
 * @param {unknown} value
 * @returns {typeof defaultFeaturePages}
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

/**
 * Dialog that edits one portal page URL from 功能设置.
 * Ticketed portals also manage their desktop login provider credentials.
 * Portaled to document.body so Enter / IME candidate clicks are not owned by the settings form.
 * @param {{ featureKey: keyof typeof defaultFeaturePages, value: typeof defaultFeaturePages, disabled?: boolean, onChange: (value: typeof defaultFeaturePages) => void, onClose: () => void }} props
 */
export default function FeaturePageAddressDialog({ featureKey, value, disabled, onChange, onClose }) {
  const pages = normalizeFeaturePages(value);
  const label = FEATURE_PAGE_ENTRIES.find(([key]) => key === featureKey)?.[1] || '';
  const portalRoute = credentialRoutes[featureKey];
  const [draft, setDraft] = useState(pages[featureKey]?.url || '');
  const [error, setError] = useState('');
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credential, setCredential] = useState('');
  const [credentialError, setCredentialError] = useState('');

  useEffect(() => {
    if (!portalRoute) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await API.get(`${portalRoute}/admin/credential`);
        if (cancelled) return;
        if (response.data?.success) {
          setCredentialConfigured(Boolean(response.data.configured));
          setCredentialError('');
        } else {
          setCredentialError(response.data?.message || `无法读取${label}凭据状态`);
        }
      } catch (err) {
        if (!cancelled) {
          // Keep the dialog open: never pass AxiosError into showError (401 redirects to login).
          setCredentialError(err.response?.data?.message || err.message || `无法读取${label}凭据状态`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [label, portalRoute]);

  const confirm = () => {
    if (disabled || credential) return;
    const message = validateFeaturePageUrl(draft);
    if (message) {
      setError(message);
      return;
    }
    onChange(normalizeFeaturePages({
      ...pages,
      [featureKey]: { url: draft.trim() },
    }));
    onClose();
  };

  const rotateCredential = async () => {
    if (credentialBusy) return;
    const confirmed = window.confirm(credentialConfigured
      ? `重新生成${label}接入凭据？旧凭据会立即失效，网站 .env 需同步更换。`
      : `生成${label}接入凭据？明文只显示一次，请保存到网站服务端配置。`);
    if (!confirmed) return;
    setCredentialBusy(true);
    setCredentialError('');
    try {
      const response = await API.post(`${portalRoute}/admin/credential`);
      if (!response.data?.success || typeof response.data.provider_credential !== 'string') {
        throw new Error(response.data?.message || '生成凭据失败');
      }
      setCredential(response.data.provider_credential);
      setCredentialConfigured(true);
      showSuccess(`已生成${label}接入凭据`);
    } catch (err) {
      showError(err.response?.data?.message || err.message || '生成凭据失败');
    } finally {
      setCredentialBusy(false);
    }
  };

  return createPortal(<div className='knowledge-quota-dialog-backdrop feature-page-dialog-backdrop' role='presentation'>
    <section className='knowledge-quota-dialog feature-page-dialog' role='dialog' aria-modal='true' aria-label={`配置${label}`}
      onKeyDown={event => {
        if (event.key === 'Escape' && !disabled && !credential) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}>
      <header>
        <h3>配置{label}</h3>
        <button type='button' className='settings-secondary' disabled={disabled || Boolean(credential)} onClick={onClose}>关闭</button>
      </header>
      <label className='feature-page-url-field'>
        页面地址
        <input aria-label={`${label}页面地址`} value={draft} maxLength={2048} disabled={disabled || Boolean(credential)}
          placeholder='例如 https://land.example/#/home'
          onChange={event => { setDraft(event.target.value); setError(''); }}
          onKeyDown={event => {
            // Dialog is outside the settings <form>, but still treat Enter as confirm (not a no-op).
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            confirm();
          }} />
      </label>
      <p className='settings-description'>点「确定」后，再在本页底部「保存设置」才会写入服务器。留空表示尚未配置地址。</p>
      {portalRoute && <div className='feature-page-credential'>
        <h4 className='feature-page-credential-title'>桌面登录接入凭据</h4>
        <div className='feature-page-credential-row'>
          <p className='settings-description'>
            当前状态：{credentialConfigured ? '已配置' : '未配置'}。网站服务端用此凭据兑换桌面打开时的一次性 ticket；明文只显示一次，不要写入页面地址。
          </p>
          <button type='button' className='settings-primary' disabled={disabled || credentialBusy || Boolean(credential)}
            onClick={() => void rotateCredential()}>
            {credentialBusy ? '处理中…' : (credentialConfigured ? '重置凭据' : '生成凭据')}
          </button>
        </div>
        {credentialError && <p role='alert' className='knowledge-quota-summary is-error'>{credentialError}</p>}
      </div>}
      {error && <p role='alert' className='knowledge-quota-summary is-error'>{error}</p>}
      <footer>
        <button type='button' className='settings-secondary' disabled={disabled || Boolean(credential)} onClick={onClose}>取消</button>
        <button type='button' className='settings-primary' disabled={disabled || Boolean(credential)} onClick={confirm}>确定</button>
      </footer>
    </section>
    {credential && <div className='knowledge-quota-dialog-backdrop feature-page-credential-secret-backdrop' role='presentation'>
      <section className='knowledge-quota-dialog feature-page-credential-secret' role='dialog' aria-modal='true' aria-label={`${label}提供方凭据`}>
        <h3>请保存{label}接入凭据</h3>
        <p className='settings-description'>只显示这一次。写入网站服务端 `provider-credential` / `.env`，不要放进网页、桌面端或地址配置。</p>
        <code className='feature-page-credential-code'>{credential}</code>
        <p className='settings-description'>兑换地址：<code>{portalRoute}/redeem</code></p>
        <footer>
          <button type='button' className='settings-primary' onClick={() => setCredential('')}>我已保存，关闭</button>
        </footer>
      </section>
    </div>}
  </div>, document.body);
}
