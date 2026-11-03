import React from 'react';

export const defaultCreditRewards = {
  registration: { enabled: false, amount: 2000 },
  login: { enabled: false, amount: 100, intervalDays: 1 },
};

export function normalizeCreditRewards(value) {
  if (value === undefined) return JSON.parse(JSON.stringify(defaultCreditRewards));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('积分赠送配置无效');
  for (const key of ['registration', 'login']) {
    const rule = value[key];
    if (!rule || typeof rule.enabled !== 'boolean' || !Number.isInteger(rule.amount) || rule.amount < 1 || rule.amount > 1000000) {
      throw new Error('赠送积分必须为 1 至 1,000,000 的整数，且需要设置独立开关');
    }
  }
  if (!Number.isInteger(value.login.intervalDays) || value.login.intervalDays < 1 || value.login.intervalDays > 3650) {
    throw new Error('登录发放周期必须为 1 至 3,650 天的整数');
  }
  return {
    registration: { enabled: value.registration.enabled, amount: value.registration.amount },
    login: { enabled: value.login.enabled, amount: value.login.amount, intervalDays: value.login.intervalDays },
  };
}

export default function CreditRewardSettings({ value, onChange, disabled }) {
  const change = (key, field, next) => onChange({ ...value, [key]: { ...value[key], [field]: next } });
  return <section className='settings-credit-rewards' aria-label='积分赠送规则'>
    <div className='credit-pricing-heading'><h3>积分赠送规则</h3><span className='credit-preview-tag'>运营版</span></div>
    <p className='settings-description'>统一配置注册与登录赠送，金额单位为积分。</p>
    <div className='credit-reward-grid'>
      {['registration', 'login'].map(key => {
        const title = key === 'registration' ? '注册赠送' : '登录赠送';
        const rule = value[key];
        return <div className='credit-reward-card' key={key}>
          <div className='credit-reward-heading'><h4>{title}</h4><label className='credit-reward-toggle'>
            <input type='checkbox' role='switch' aria-label={`启用${title}`} checked={rule.enabled} disabled={disabled}
              onChange={event => change(key, 'enabled', event.target.checked)} />{rule.enabled ? '开启' : '关闭'}
          </label></div>
          <p>{key === 'registration' ? '新用户注册成功后赠送，每人仅一次。' : '达到发放周期后，在首次登录时赠送。'}</p>
          <label className='credit-reward-field'>每次赠送积分
            <div><input aria-label={`${title}积分`} type='number' min='1' max='1000000' step='1' required disabled={disabled || !rule.enabled}
              value={rule.amount} onChange={event => change(key, 'amount', event.target.value === '' ? '' : Number(event.target.value))} /><span>积分</span></div>
          </label>
          {key === 'login' && <label className='credit-reward-field'>发放周期
            <div><span>每</span><input aria-label='登录发放周期' type='number' min='1' max='3650' step='1' required disabled={disabled || !rule.enabled}
              value={rule.intervalDays} onChange={event => change(key, 'intervalDays', event.target.value === '' ? '' : Number(event.target.value))} /><span>天赠送一次</span></div>
          </label>}
          <small>{key === 'registration' ? '不向已注册用户补发。' : '首次登录可领取；后续按上次发放日起算，未登录不补发。'}</small>
        </div>;
      })}
    </div>
    <p className='credit-pricing-note'>当前保存赠送规则，自动发放链路接入后生效。规则修改记录在后台操作日志中。</p>
  </section>;
}
