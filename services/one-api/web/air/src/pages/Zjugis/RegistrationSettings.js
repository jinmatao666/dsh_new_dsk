import React, { useEffect, useState } from 'react';
import { API } from '../../helpers';
import { fetchManagedRoles } from '../../helpers/roles';

const fields = [
  ['RegistrationDefaultRole', '新注册用户默认角色', 'role'],
  ['SMSEnabled', '启用短信服务', 'switch'], ['PhoneLoginEnabled', '允许短信登录', 'switch'],
  ['RegisterEnabled', '开放新用户注册', 'switch'], ['PhoneRegisterEnabled', '允许手机号注册', 'switch'],
  ['SMSProvider', '短信提供商', 'provider'], ['SMSAccessKeyId', '阿里云 AccessKey ID', 'text'],
  ['SMSAccessKeySecret', '阿里云 AccessKey Secret', 'password'], ['SMSSignName', '短信签名', 'text'],
  ['SMSTemplateCode', '验证码模板 CODE', 'text'], ['SMSRegion', '阿里云地域', 'text'],
  ['PhoneVerificationCodeLength', '验证码位数（4–6）', 'number'],
  ['PhoneVerificationValidMinutes', '验证码有效期（分钟）', 'number'], ['PhoneMaxSendPerHour', '每个手机号每小时发送上限', 'number'],
  ['WeChatAuthEnabled', '启用微信扫码登录', 'switch'], ['WeChatAppID', '微信网站应用 AppID', 'text'],
  ['WeChatAppSecret', '微信网站应用 AppSecret', 'password'], ['ServerAddress', '服务端公网地址（微信回调）', 'url'],
  ['RegistrationAgreementText', '用户协议正文', 'textarea'], ['RegistrationPrivacyText', '隐私政策正文', 'textarea'],
];

/** Separate server-owned authentication options; no credentials enter desktop configuration. */
export default function RegistrationSettings() {
  const [roles, setRoles] = useState([]);
  const [values, setValues] = useState(null), [saved, setSaved] = useState({});
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([API.get('/api/option/'), fetchManagedRoles()]).then(([{ data }, roleList]) => {
      if (active) setRoles(roleList.filter(role => role.role >= 1 && role.role < 10 && role.status === 1));
      if (!data.success) throw new Error(data.message || '加载失败');
      const next = Object.fromEntries(fields.map(([key,,type]) => [key, type === 'password' ? '' : String(data.data.find(item => item.key === key)?.value || '')]));
      if (active) { setValues(next); setSaved(next); setFeedback(''); }
    }).catch(error => { if (active) setFeedback(error.response?.data?.message || error.message); });
    return () => { active = false; };
  }, [reload]);
  const dirty = values && fields.some(([key]) => values[key] !== saved[key]);
  const save = async event => {
    event.preventDefault(); setBusy(true); setFeedback('');
    let nextSaved = { ...saved };
    try {
      // Credentials first, dependent switches last. Preserve successfully saved fields on partial failure.
      const changed = fields.filter(([key,,type]) => values[key] !== saved[key] && (type !== 'password' || values[key]));
      changed.sort((a,b) => Number(a[2] === 'switch') - Number(b[2] === 'switch'));
      for (const [key,,type] of changed) {
        const { data } = await API.put('/api/option/', { key, value: values[key] });
        if (!data.success) throw new Error(data.message || '保存失败');
        nextSaved[key] = type === 'password' ? '' : values[key];
        setSaved({ ...nextSaved });
        if (type === 'password') setValues(current => ({ ...current, [key]: '' }));
      }
      setFeedback('登录与注册设置已保存');
    } catch (error) { setFeedback('保存未全部完成：' + (error.response?.data?.message || error.message)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className='registration-settings'>
    <h2>登录与注册</h2><p className='settings-description'>统一配置注册方式、默认角色及短信服务。默认角色仅影响新注册账号，已有账户继续使用原来的角色。</p>
    <p className='settings-description'>微信需申请微信开放平台网站应用。短信签名、模板审核通过后再填写并启用；密钥留空表示保留原值。</p>
    {!values ? <><p role='status'>{feedback || '正在加载…'}</p><button type='button' className='settings-secondary' onClick={() => setReload(value => value + 1)}>重新加载</button></> : <>
      <div className='registration-settings-grid'>{fields.map(([key,label,type]) => <label key={key} className={type === 'textarea' ? 'registration-settings-wide' : ''}><span>{label}</span>
        {type === 'switch' ? <input type='checkbox' checked={values[key] === 'true'} disabled={busy} onChange={event => setValues({ ...values, [key]: String(event.target.checked) })} />
          : type === 'textarea' ? <textarea rows={5} maxLength={30000} value={values[key]} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })} />
          : type === 'role' ? <select aria-label={label} value={values[key]} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })}><option value=''>注册用户（默认）</option>{roles.map(role => <option key={role.role} value={String(role.role)}>{role.name}</option>)}</select>
          : type === 'provider' ? <select value={values[key] || 'aliyun'} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })}><option value='aliyun'>阿里云短信</option></select>
          : <input type={type} autoComplete='off' value={values[key]} disabled={busy} min={key === 'PhoneVerificationCodeLength' ? 4 : 1} max={key === 'PhoneVerificationCodeLength' ? 6 : key === 'PhoneMaxSendPerHour' ? 100 : 30} placeholder={type === 'password' ? '不修改时留空' : ''} onChange={event => setValues({ ...values, [key]: event.target.value })} />}
      </label>)}</div>
      {feedback && <p role='status'>{feedback}</p>}
      <div className='settings-footer'><span>{dirty ? '有未保存的修改' : ''}</span><button type='submit' className='settings-primary' disabled={!dirty || busy}>{busy ? '保存中…' : '保存设置'}</button></div>
    </>}
  </form>;
}
