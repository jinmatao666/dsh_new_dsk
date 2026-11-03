/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CreditLogs from './CreditLogs';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn() } }));
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.resetAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('actual debit and disjoint cached buckets display from frozen receipt; pages fetch separately', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: { total: 51, page_size: 50, items: [{
    id: 1, created_at: 1793664000, username: 'alice', model_name: 'test', prompt_tokens: 1000,
    completion_tokens: 500, cache_read_tokens: 800, quota: 354,
    credit_billing: JSON.stringify({ base: 1, group: 1, input: 0.15, output: 0.6, cache_read: 0.03,
      cache_write: 0.15, input_tokens: 200, output_tokens: 500, cache_read_tokens: 800, cache_write_tokens: 0,
      quota_per_unit: 1000, source: 'configured', status: 'settled' }),
  }] } } });
  await act(async () => root.render(<CreditLogs />));
  expect(container.textContent).toContain('0.354 积分');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '查看').click());
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('普通输入200');
  expect(dialog.textContent).toContain('缓存命中800');
  expect(dialog.textContent).toContain('0.024');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '下一页').click());
  expect(API.get).toHaveBeenLastCalledWith('/api/log/credits?p=1&keyword=');
});

test('failed load supports retry and missing snapshots do not invent prices', async () => {
  API.get.mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce({ data: { success: true,
    data: { total: 1, page_size: 50, items: [{ id: 1, quota: 300, created_at: 1 }] } } });
  await act(async () => root.render(<CreditLogs />));
  expect(container.querySelector('[role="alert"]').textContent).toContain('连接失败');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重试').click());
  expect(container.textContent).toContain('300 内部额度');
  expect(container.textContent).toContain('历史记录');
});
