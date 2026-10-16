import React, { useEffect, useState } from 'react';
import { API, showSuccess } from '../../helpers';
import './SystemSettings.css';

const defaults = { network: 'internet', edition: 'operations', operator: '', phone: '', features: {
  internet: { automations: true, connectors: true },
  intranet: { automations: true, connectors: false },
}, plugins: { browserAssistant: true } };
const tabs = [['account', '账户设置'], ['security', '安全设置'], ['network', '网络设置'], ['edition', '版本类型'], ['features', '功能设置'], ['operations', '运维设置'], ['plugins', '插件设置']];
const descriptions = {
  network: '设置桌面端使用的部署网络环境。',
  edition: '选择本系统的版本类型，网络环境与功能开关保持独立。',
  features: '内网与互联网独立配置。关闭后隐藏桌面端入口，桌面端启动、登录或切回窗口刷新后生效；开启不代表外部服务在内网可访问。',
  operations: '填写负责本系统日常维护的人员及联系电话。',
  plugins: '统一控制桌面端插件。关闭后用户无法开启；开启后用户可自行启停。桌面端启动、登录或切回窗口刷新后生效，不强制中断已开始的操作。原有网络限制仍然有效。',
};

async function loadSettingsResponse(path, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await API.get(path, { signal, timeout: 10000 });
      if (response.data?.success !== true) {
        throw new Error(response.data?.message || '服务返回异常，请重新加载；仍失败请联系管理员');
      }
      return response.data.data;
    } catch (error) {
      const status = error.response?.status;
      const transient = status === 408 || status === 429 || status >= 500
        || (!error.response && ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code));
      if (signal.aborted || !transient || attempt >= 2) {
        const message = error.response?.data?.message;
        throw new Error(message || (status === 401 ? '登录已失效，请重新登录'
          : status === 403 ? '没有查看系统配置的权限，请联系管理员'
            : transient ? '网络或服务暂时不可用，请重新加载' : error.message));
      }
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, 500 * (attempt + 1));
        signal.addEventListener('abort', finish, { once: true });
      });
      if (signal.aborted) throw new Error('加载已取消');
    }
  }
}

/** Deployment metadata uses the existing root-only options API, not browser storage. */
export default function SystemSettings() {
  const [active, setActive] = useState('account');
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(defaults);
  const [saved, setSaved] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setFeedback(''); setUser(null);
    loadSettingsResponse('/api/user/self', controller.signal).then(async profile => {
      if (!profile || typeof profile.role !== 'number') throw new Error('账户信息返回异常，请重新加载');
      if (!disposed) setUser(profile);
      if (profile.role !== 100 || disposed) return;
      const options = await loadSettingsResponse('/api/option/', controller.signal);
      if (!Array.isArray(options)) throw new Error('系统配置返回异常，请重新加载');
      const raw = options.find(item => item.key === 'SystemDeploymentSettings')?.value;
      const value = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
      if (typeof value.plugins?.browserAssistant !== 'boolean') throw new Error('插件设置无效，请联系管理员检查配置');
      if (!['government', 'operations'].includes(value.edition)) throw new Error('版本类型无效，请联系管理员检查配置');
      for (const mode of ['internet', 'intranet']) {
        for (const feature of ['automations', 'connectors']) {
          if (typeof value.features?.[mode]?.[feature] !== 'boolean') throw new Error('功能设置无效，请联系管理员检查配置');
        }
      }
      if (!disposed) { setSettings(value); setSaved(value); }
    }).catch(error => { if (!disposed) setLoadError(error.message || '设置加载失败，请刷新重试'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; controller.abort(); };
  }, [reload]);
  const change = (key, value) => { setSettings(previous => ({ ...previous, [key]: value })); setFeedback(''); };
  const save = async event => {
    event.preventDefault();
    if (loading || loadError || saving || user?.role !== 100) return;
    setSaving(true); setFeedback('');
    const value = { ...settings, operator: settings.operator.trim(), phone: settings.phone.trim() };
    try {
      const response = await API.put('/api/option/', { key: 'SystemDeploymentSettings', value: JSON.stringify(value) });
      if (!response.data.success) throw new Error(response.data.message || '保存失败');
      setSettings(value); setSaved(value); showSuccess('设置已保存');
    } catch (error) { setFeedback(error.message || '保存失败，请重试'); }
    finally { setSaving(false); }
  };
  const logout = async () => {
    try { await API.get('/api/user/logout'); localStorage.removeItem('user'); window.location.href = '/login'; }
    catch { setFeedback('退出失败，请重试'); }
  };
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  return <div className='zjugis-new-page system-settings-page'>
    <div className='preview-page-head'><div><h1>系统设置</h1><p>管理账户、安全、部署网络环境、功能入口与运维联系信息。</p></div></div>
    <section className='preview-surface system-settings-surface'>
      <div className='preview-tabs' role='tablist' aria-label='系统设置'>
        {tabs.map(([key, label]) => <button type='button' role='tab' id={`settings-tab-${key}`} aria-controls={`settings-panel-${key}`} aria-selected={active === key} key={key} className={active === key ? 'active' : ''} onClick={() => { setActive(key); setFeedback(''); }}>{label}</button>)}
      </div>
      {loading ? <p role='status'>正在加载设置，网络异常时会自动重试…</p> : loadError && (!user || ['network', 'edition', 'features', 'operations', 'plugins'].includes(active)) ? <div><p role='alert'>{loadError}</p><button type='button' className='settings-secondary' onClick={() => setReload(value => value + 1)}>重新加载</button></div> :
        <div role='tabpanel' id={`settings-panel-${active}`} aria-labelledby={`settings-tab-${active}`} className='system-settings-panel'>
          {active === 'account' && <><h2>账户信息</h2><p className='settings-description'>当前登录的后台管理账户。</p><div className='settings-account-details'>
            <div className='account-row'><span>登录账号</span><strong>{user?.username || '—'}</strong></div>
            <div className='account-row'><span>账户角色</span><strong className='green'>{user?.role === 100 ? '超级管理员' : '管理员'}</strong></div>
            <div className='account-row'><span>登录状态</span><strong className='green'>已登录</strong></div>
          </div></>}
          {active === 'security' && <><h2>安全设置</h2><p className='settings-description'>查看当前登录会话与安全状态。</p><div className='settings-account-details'>
            <div className='account-row'><span>会话有效期</span><strong>默认</strong></div>
            <div className='account-row'><span>登录保护</span><strong className='green'>已启用</strong></div>
          </div><button type='button' className='settings-secondary settings-logout' onClick={logout}>退出登录</button></>}
          {['network', 'edition', 'features', 'operations', 'plugins'].includes(active) && (user?.role !== 100 ? <p>仅超级管理员可查看和修改系统部署配置。</p> : <form onSubmit={save}>
            <h2>{active === 'network' ? '网络环境' : active === 'edition' ? '版本类型' : active === 'features' ? '功能入口' : active === 'plugins' ? '插件控制' : '运维联系信息'}</h2>
            <p className='settings-description'>{descriptions[active]}</p>
            {active === 'plugins' ? <>
              <table className='settings-features'><thead><tr><th scope='col'>插件</th><th scope='col'>统一开关</th></tr></thead><tbody><tr><th scope='row'>浏览器助手</th><td><label>
                <input type='checkbox' role='switch' aria-label='统一启用浏览器助手' checked={settings.plugins.browserAssistant} disabled={saving} onChange={event => change('plugins', { ...settings.plugins, browserAssistant: event.target.checked })} />
                <span>{settings.plugins.browserAssistant ? '开启' : '关闭'}</span>
              </label></td></tr></tbody></table></> : active === 'edition' ? <fieldset className='settings-network'><legend>版本类型</legend>
              {[['government', '政务版', '适用于政务场景'], ['operations', '运营版', '适用于运营场景']].map(([key, label, hint]) => <label key={key} className={`settings-network-option${settings.edition === key ? ' selected' : ''}`}>
                <input type='radio' name='edition' value={key} checked={settings.edition === key} onChange={() => change('edition', key)} disabled={saving} /><span><strong>{label}</strong><small>{hint}</small></span>
              </label>)}
            </fieldset> : active === 'features' ? <table className='settings-features'><thead><tr><th scope='col'>功能</th><th scope='col'>互联网环境</th><th scope='col'>纯内网环境</th></tr></thead><tbody>
              {[['automations', '自动化'], ['connectors', '连接器']].map(([feature, label]) => <tr key={feature}><th scope='row'>{label}</th>
                {['internet', 'intranet'].map(mode => <td key={mode}><label><input type='checkbox' role='switch' aria-label={`${mode === 'internet' ? '互联网' : '纯内网'}${label}`} checked={settings.features[mode][feature]} disabled={saving} onChange={event => change('features', { ...settings.features, [mode]: { ...settings.features[mode], [feature]: event.target.checked } })} /><span>{settings.features[mode][feature] ? '开启' : '关闭'}</span></label></td>)}
              </tr>)}
            </tbody></table> : active === 'network' ? <fieldset className='settings-network'><legend>网络类型</legend>
              {[['internet', '外网（互联网）', '部署于可访问互联网的网络环境'], ['intranet', '内网', '部署于单位内部网络环境']].map(([key, label, hint]) => <label key={key} className={`settings-network-option${settings.network === key ? ' selected' : ''}`}>
                <input type='radio' name='network' value={key} checked={settings.network === key} onChange={() => change('network', key)} disabled={saving} /><span><strong>{label}</strong><small>{hint}</small></span>
              </label>)}
            </fieldset> : <div className='settings-contact-fields'>
              <label>运维人员<input value={settings.operator} maxLength={80} placeholder='请输入运维人员姓名' disabled={saving} onChange={event => change('operator', event.target.value)} /></label>
              <label>联系电话<input type='tel' value={settings.phone} maxLength={40} placeholder='请输入手机号或固定电话' disabled={saving} onChange={event => change('phone', event.target.value)} /></label>
            </div>}
            <div className='settings-footer'><span>{dirty ? '有未保存的修改' : ''}</span><div><button type='button' className='settings-secondary' disabled={!dirty || saving} onClick={() => { setSettings(saved); setFeedback(''); }}>取消修改</button><button type='submit' className='settings-primary' disabled={!dirty || saving}>{saving ? '保存中…' : '保存设置'}</button></div></div>
          </form>)}
        </div>}
      {feedback && <p className='settings-feedback' role='status'>{feedback}</p>}
    </section>
  </div>;
}
