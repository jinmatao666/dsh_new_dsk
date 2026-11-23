/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import ForumCreditSettings from './ForumCreditSettings';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() }, showSuccess: jest.fn() }));
let root, container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  API.get.mockResolvedValue({ data: { success: true, data: { qa: { credits: 1, version: 1 }, report: { credits: 1, version: 1 } } } });
  API.put.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('loads both default prices and saves distinct server-owned amounts immediately', async () => {
  const close = jest.fn();
  await act(async () => root.render(<ForumCreditSettings onClose={close} />));
  const dialog = document.querySelector('[aria-label="资规讲坛积分配置"]');
  const qa = dialog.querySelector('[aria-label="弹框问答积分"]');
  const report = dialog.querySelector('[aria-label="生成报告积分"]');
  expect([qa.value, report.value]).toEqual(['1', '1']);
  act(() => { Simulate.change(qa, { target: { value: '2' } }); });
  act(() => { Simulate.change(report, { target: { value: '0' } }); });
  await act(async () => dialog.querySelector('.settings-primary').click());
  expect(API.put).toHaveBeenCalledWith('/api/portal/planning-lecture/admin/credits', {
    qa: { credits: '2', version: 1 }, report: { credits: '0', version: 1 },
  });
  expect(close).toHaveBeenCalledTimes(1);
});

test('keeps edits visible when another administrator has changed the price', async () => {
  const close = jest.fn();
  API.put.mockRejectedValue({ response: { data: { code: 'PRICE_CHANGED' } } });
  await act(async () => root.render(<ForumCreditSettings onClose={close} />));
  const dialog = document.querySelector('[aria-label="资规讲坛积分配置"]');
  await act(async () => dialog.querySelector('.settings-primary').click());
  expect(dialog.querySelector('[role="alert"]').textContent).toContain('配置已被修改');
  expect(close).not.toHaveBeenCalled();
});

test('prevents saving when the server price could not be loaded', async () => {
  API.get.mockRejectedValue(new Error('暂时不可用'));
  await act(async () => root.render(<ForumCreditSettings onClose={() => {}} />));
  expect(document.querySelector('[role="alert"]').textContent).toContain('暂时不可用');
  expect(document.querySelector('.settings-primary').disabled).toBe(true);
  expect(API.put).not.toHaveBeenCalled();
});
