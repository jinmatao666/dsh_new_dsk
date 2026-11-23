/* eslint-disable testing-library/no-unnecessary-act -- Direct React root. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CreditStats from './CreditStats';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

test('searches users and shows signed, traceable credit changes in Beijing time', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: {
    total: 1, incoming: 3000, outgoing: 0, quota_per_credit: 1000,
    items: [{ id: 13, occurred_at: Date.UTC(2026, 10, 20, 7, 0) / 1000, user_id: 7, username: 'alice', actor_id: 9, actor_name: 'root', source: 'admin', reference: 'grant-13', delta: 3000, balance_before: 1000, balance_after: 4000 }],
  } } });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CreditStats from="2026-11-20" to="2026-11-20" />));
    expect(container.textContent).toContain('15:00:00');
    expect(container.querySelector('tbody').textContent).toContain('+3');
    expect(container.querySelector('tbody').textContent).toContain('grant-13');
    expect(container.querySelector('tbody').textContent).toContain('root');
    const input = container.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '13800138000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(API.get.mock.calls.at(-1)[1].params).toMatchObject({ keyword: '13800138000', from: '2026-11-20', to: '2026-11-20', page: 1 });
  } finally { await act(async () => root.unmount()); container.remove(); }
});
