import React, { useEffect, useState } from 'react';
import CustomSelect from '../../components/CustomSelect';
import { API } from '../../helpers';
import { fetchManagedRoles } from '../../helpers/roles';

const fields = [
  ['RegistrationDefaultRole', '新注册用户默认角色', 'role'],
  ['SMSEnabled', '启用短信服务', 'switch'], ['PhoneLoginEnabled', '允许短信登录', 'switch'],
  ['RegisterEnabled', '开放新用户注册', 'switch'], ['PhoneRegisterEnabled', '允许手机号注册', 'switch'],
  ['SMSAccessKeyId', '阿里云 AccessKey ID', 'text'],
  ['SMSAccessKeySecret', '阿里云 AccessKey Secret', 'password'], ['SMSSignName', '短信签名', 'text'],
  ['SMSTemplateCode', '验证码模板 CODE', 'text'],
  ['RegistrationAgreementText', '用户协议正文', 'textarea'], ['RegistrationPrivacyText', '隐私政策正文', 'textarea'],
];

const sections = [
  { id: 'registration', title: '注册设置', hint: '设置新用户注册方式与默认角色，已有账号的角色不受影响。', keys: ['RegisterEnabled', 'PhoneRegisterEnabled', 'RegistrationDefaultRole'] },
  { id: 'sms', title: '短信登录', hint: '配置阿里云短信服务。密钥留空保留原值；验证码默认6位、5分钟有效，发送间隔60秒。', keys: ['SMSEnabled', 'PhoneLoginEnabled', 'SMSAccessKeyId', 'SMSAccessKeySecret', 'SMSSignName', 'SMSTemplateCode'] },
  { id: 'policies', title: '协议与隐私', hint: '供用户注册时阅读和确认。', keys: ['RegistrationAgreementText', 'RegistrationPrivacyText'] },
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
    {!values ? <><p role='status'>{feedback || '正在加载…'}</p><button type='button' className='settings-secondary' onClick={() => setReload(value => value + 1)}>重新加载</button></> : <>
      {sections.map(section => <section key={section.id} className='registration-settings-section' aria-labelledby={`registration-${section.id}`}><h3 id={`registration-${section.id}`}>{section.title}</h3><p className='settings-description'>{section.hint}</p>
      <div className='registration-settings-grid'>{section.keys.map(key => fields.find(field => field[0] === key)).map(([key,label,type]) => <label key={key} className={type === 'textarea' ? 'registration-settings-wide' : ''}><span>{label}</span>
        {type === 'switch' ? <CustomSelect aria-label={label} value={values[key] === 'true' ? 'true' : 'false'} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })}><option value='false'>关闭</option><option value='true'>开启</option></CustomSelect>
          : type === 'textarea' ? <textarea rows={5} maxLength={30000} value={values[key]} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })} />
          : type === 'role' ? <CustomSelect aria-label={label} value={values[key]} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })}><option value=''>注册用户（默认）</option>{roles.map(role => <option key={role.role} value={String(role.role)}>{role.name}</option>)}</CustomSelect>
          : type === 'provider' ? <CustomSelect aria-label={label} value={values[key] || 'aliyun'} disabled={busy} onChange={event => setValues({ ...values, [key]: event.target.value })}><option value='aliyun'>阿里云短信</option></CustomSelect>
          : <input type={type} autoComplete='off' value={values[key]} disabled={busy} min={key === 'PhoneVerificationCodeLength' ? 4 : 1} max={key === 'PhoneVerificationCodeLength' ? 6 : key === 'PhoneMaxSendPerHour' ? 100 : 30} placeholder={type === 'password' ? '不修改时留空' : ''} onChange={event => setValues({ ...values, [key]: event.target.value })} />}
      </label>)}</div></section>)}
      {feedback && <p role='status'>{feedback}</p>}
      <div className='settings-footer'><span>{dirty ? '有未保存的修改' : ''}</span><button type='submit' className='settings-primary' disabled={!dirty || busy}>{busy ? '保存中…' : '保存设置'}</button></div>
    </>}
  </form>;
}
