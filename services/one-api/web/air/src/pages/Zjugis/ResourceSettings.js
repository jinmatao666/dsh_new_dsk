import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';

export const defaultResources = {
  source: 'offline', proxyUrl: '', autoDetect: false,
  probeUrls: ['https://www.gstatic.com/generate_204', 'https://cp.cloudflare.com/generate_204'],
};

/** Uploading replaces the shared bundle; saving selects the resource source. */
export default function ResourceSettings({ value = defaultResources, onChange, disabled }) {
  const [bundle, setBundle] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    API.get('/api/desktop-resources', { signal: controller.signal }).then(response => {
      if (response.data.success && Array.isArray(response.data.data?.files)) setBundle(response.data.data);
    }).catch(error => {
      if (!controller.signal.aborted && error.response?.status !== 404) setMessage('无法读取依赖包状态，请重新打开此页');
    });
    return () => controller.abort();
  }, []);
  const change = patch => onChange({ ...value, ...patch });
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 512 * 1024 * 1024) { setMessage('ZIP 不能超过 512MB'); return; }
    setUploading(true); setMessage('正在上传并校验依赖包…');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await API.post('/api/desktop-resources', form, { timeout: 300000 });
      if (!response.data.success) throw new Error(response.data.message);
      setBundle(response.data.data); setMessage('依赖包已替换。资源方式仍以保存设置为准。');
    } catch (error) { setMessage(error.response?.data?.message || error.message || '上传失败，请重试'); }
    finally { setUploading(false); }
  };
  return <section className='settings-resources' aria-label='内网资源配置'>
    <fieldset className='settings-network' disabled={disabled || uploading}><legend>资源获取方式（二选一）</legend>
      {[['offline', '离线依赖包', '仅使用已有依赖和后台依赖包，不切换到中转服务器。'],
        ['proxy', '联网中转服务器', '通过 HTTP 正向代理下载依赖和资源，不读取离线包。']].map(([key, label, hint]) =>
        <label key={key} className={`settings-network-option${value.source === key ? ' selected' : ''}`}>
          <input type='radio' name='resource-source' checked={value.source === key} onChange={() => change({ source: key })} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
    </fieldset>
    {value.source === 'proxy' ? <div className='settings-resource-fields'>
      <label>中转服务器地址<input type='url' required placeholder='http://192.168.1.10:3128' value={value.proxyUrl}
        disabled={disabled} onChange={event => change({ proxyUrl: event.target.value.trim() })} /></label>
      <p className='settings-description'>需部署 HTTP 正向代理服务，仅填写 IP 不够。首版通过服务器客户端网段白名单控制访问，不填写账号密码。</p>
      <label className='settings-resource-switch'><input type='checkbox' checked={value.autoDetect} disabled={disabled}
        onChange={event => change({ autoDetect: event.target.checked })} />自动检测桌面机器是否能直连互联网</label>
      <p className='settings-description'>{value.autoDetect ? '两个检测地址均返回 HTTP 204 时直连，否则使用中转；结果缓存 60 秒。' : '不检测，桌面端直接使用中转服务器。'}</p>
      {value.autoDetect && <label>直连检测地址（每行一个，2—4 个公网 HTTPS 地址，需返回 HTTP 204）
        <textarea rows={3} value={value.probeUrls.join('\n')} disabled={disabled}
          onChange={event => change({ probeUrls: event.target.value.split('\n') })} /></label>}
    </div> : <div className='settings-resource-fields'>
      <p>Python wheel 依赖包：{bundle ? `${bundle.files.length} 个文件，包标识 ${bundle.id}` : '尚未上传'}</p>
      <label>上传或替换依赖 ZIP<input type='file' accept='.zip' disabled={disabled || uploading} onChange={upload} /></label>
      <p className='settings-description'>ZIP 根目录仅放 .whl，包含所需包及其间接依赖，且匹配桌面端的操作系统和 Python 版本。最大 512MB。上传后立即替换公共依赖库，不包含客户文件。</p>
    </div>}
    {message && <p role='status'>{message}</p>}
    <p className='settings-description'>首版支持 pip 及遵循 HTTP(S)_PROXY 的命令行下载工具，不是全系统 VPN。切换后请停止旧任务，再启动新任务；已启动的进程不会被改写。</p>
  </section>;
}
