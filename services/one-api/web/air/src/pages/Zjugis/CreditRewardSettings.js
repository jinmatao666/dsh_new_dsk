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
    throw new Error('签到发放周期必须为 1 至 3,650 天的整数');
  }
  return {
    registration: { enabled: value.registration.enabled, amount: value.registration.amount },
    login: { enabled: value.login.enabled, amount: value.login.amount, intervalDays: value.login.intervalDays },
  };
}

export default function CreditRewardSettings({ value, onChange, disabled }) {
  const change = (key, field, next) => onChange({ ...value, [key]: { ...value[key], [field]: next } });
  return <section className='settings-credit-rewards edition-settings-row' aria-label='积分赠送规则'>
    <div className='edition-section-heading'><h3>积分赠送规则</h3><p>分别管理注册与签到赠送</p></div>
    <div className='edition-section-content'>
    <div className='credit-reward-grid'>
      {['registration', 'login'].map(key => {
        const title = key === 'registration' ? '注册赠送' : '签到赠送';
        const rule = value[key];
        return <div className='credit-reward-card' key={key}>
          <div className='credit-reward-heading'><h4>{title}</h4>
            <p>{key === 'registration' ? '仅赠送新用户，不向老用户补发。' : '用户主动签到领取，未签到不补发。'}</p>
          </div>
          <label className='credit-reward-field'>每次赠送积分
            <div><input aria-label={`${title}积分`} type='number' min='1' max='1000000' step='1' required disabled={disabled || !rule.enabled}
              value={rule.amount} onChange={event => change(key, 'amount', event.target.value === '' ? '' : Number(event.target.value))} /><span>积分</span></div>
          </label>
          {key === 'login' ? <label className='credit-reward-field credit-reward-period'>发放周期
            <div><span>每</span><input aria-label='签到发放周期' type='number' min='1' max='3650' step='1' required disabled={disabled || !rule.enabled}
              value={rule.intervalDays} onChange={event => change(key, 'intervalDays', event.target.value === '' ? '' : Number(event.target.value))} /><span>天赠送一次</span></div>
          </label> : <div className='credit-reward-field credit-reward-period'><span>发放周期</span><div>注册成功，仅一次</div></div>}
          <label className='credit-reward-toggle'>
            <input type='checkbox' role='switch' aria-label={`启用${title}`} checked={rule.enabled} disabled={disabled}
              onChange={event => change(key, 'enabled', event.target.checked)} /><span>{rule.enabled ? '开启' : '关闭'}</span>
          </label>
        </div>;
      })}
    </div>
    <p className='credit-pricing-note'>签到周期从上次签到日期起算，按北京时间计算，未签到不补发。注册赠送仅面向新注册用户。</p>
    </div>
  </section>;
}
