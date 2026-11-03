// 独立输入、输出和缓存倍率；未配置的模型继续使用原有倍率。
export const CREDIT_PRICING_OPTION = 'ModelCreditPricing';
export const DEFAULT_CREDIT_BASE = 1;

export function averageCreditRatio(input, output) {
  if (!validCreditNumber(input, true) || !validCreditNumber(output, true)) return '';
  return Number(((Number(input) + Number(output)) / 2).toPrecision(15));
}

export function validCreditNumber(value, allowZero = false) {
  return value !== '' && value !== null && Number.isFinite(Number(value))
    && (allowZero ? Number(value) >= 0 : Number(value) > 0)
    && Number(value) <= 1000000;
}

export function creditPrice(base, ratio) {
  if (!validCreditNumber(base) || !validCreditNumber(ratio, true)) return '—';
  return Number(base) * Number(ratio);
}

export function formatCreditPrice(value) {
  return typeof value === 'number'
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 12 }) : '—';
}

export function formatModelCreditRatios(model, previews) {
  const saved = previews[model.name];
  // 没有预览配置时，输出倍率由现有输入倍率和相对补全倍率换算。
  const input = saved ? saved.input : model.model_ratio;
  const output = saved ? saved.output : typeof input === 'number' && typeof model.completion_ratio === 'number'
    ? input * model.completion_ratio : undefined;
  const display = value => typeof value === 'number' && Number.isFinite(value) ? `${formatCreditPrice(value)}×` : '—';
  return `${display(input)} / ${display(output)}`;
}

export function readCreditPricing(options) {
  const deployment = JSON.parse(options.SystemDeploymentSettings || '{}');
  const base = deployment.creditPricingBase ?? DEFAULT_CREDIT_BASE;
  if (!validCreditNumber(base)) throw new Error('积分计费基准无效');
  const models = JSON.parse(options[CREDIT_PRICING_OPTION] || '{}');
  if (!models || Array.isArray(models) || typeof models !== 'object') throw new Error('模型积分预览配置无效');
  return { base: Number(base), models };
}
