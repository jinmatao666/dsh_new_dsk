import { creditPrice, readCreditPricing, validCreditNumber, formatModelCreditRatios } from './creditPricing';

test('list shows saved independent multipliers and converts legacy output without inventing missing rates', () => {
  const model = { name: 'test', model_ratio: 0.15, completion_ratio: 4 };
  expect(formatModelCreditRatios(model, {})).toBe('0.15× / 0.6×');
  expect(formatModelCreditRatios(model, { test: { input: 0.2, output: 0 } })).toBe('0.2× / 0×');
  expect(formatModelCreditRatios({ name: 'missing' }, {})).toBe('— / —');
});

test('input and output independently multiply the same credit base', () => {
  expect(creditPrice(1, 0.15)).toBe(0.15);
  expect(creditPrice(1, 0.6)).toBe(0.6);
  expect(creditPrice(2, 0.15)).toBe(0.3);
  expect(creditPrice(2, 0.6)).toBe(1.2);
  expect(creditPrice(1, '')).toBe('—');
  expect(creditPrice(1, 0)).toBe(0);
});

test('reads saved base and independent model prices without changing legacy ratios', () => {
  const options = { SystemDeploymentSettings: '{"creditPricingBase":2}',
    ModelCreditPricing: '{"test":{"input":0.15,"output":0.6}}',
    ModelRatio: '{"test":3}', CompletionRatio: '{"test":4}' };
  expect(readCreditPricing(options)).toEqual({ base: 2, models: { test: { input: 0.15, output: 0.6 } } });
  expect(options.ModelRatio).toBe('{"test":3}');
  expect(readCreditPricing({})).toEqual({ base: 1, models: {} });
  expect(validCreditNumber(0)).toBe(false);
  expect(validCreditNumber(Infinity)).toBe(false);
});
