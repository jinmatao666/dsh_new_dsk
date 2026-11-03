import { defaultCreditRewards, normalizeCreditRewards } from './CreditRewardSettings';

test('legacy settings default to inactive gifts and normalize without shared state', () => {
  const rules = normalizeCreditRewards();
  expect(rules).toEqual(defaultCreditRewards);
  rules.login.amount = 200;
  expect(defaultCreditRewards.login.amount).toBe(100);
});

test.each([null, [], {}, { registration: null }])('rejects incomplete reward configuration %p', value => {
  expect(() => normalizeCreditRewards(value)).toThrow();
});

test.each(['', null, 0, -1, 1.5, '100', 1000001])('rejects invalid gift amounts even when disabled: %p', amount => {
  expect(() => normalizeCreditRewards({ ...defaultCreditRewards, registration: { enabled: false, amount } })).toThrow();
});

test.each(['', null, 0, -1, 1.5, '7', 3651])('rejects invalid login cycles %p', intervalDays => {
  expect(() => normalizeCreditRewards({ ...defaultCreditRewards, login: { enabled: true, amount: 100, intervalDays } })).toThrow();
});
