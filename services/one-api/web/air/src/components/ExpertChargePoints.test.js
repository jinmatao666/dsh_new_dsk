import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExpertChargePoints from './ExpertChargePoints';
import { API, showError } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });
const change = (node, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };

test('creates a point, shows its generated ID and edits its price without changing ID', async () => {
  let items = [];
  const point = { id: 'cp_example', name: '分析报告', description: '', credits: 5, enabled: false, version: 1 };
  API.get.mockImplementation(() => Promise.resolve({ data: { success: true, data: items } }));
  API.post.mockImplementation(async () => { items = [point]; return { data: { success: true, data: point } }; });
  API.put.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ExpertChargePoints expert={{ key: 'expert-a', name: '专家 A' }} onClose={() => {}} />); });
  expect(container.textContent).toContain('还没有扣分点');
  await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent.includes('添加扣分点')).click(); });
  expect(container.querySelector('.expert-charge-body form')).toBeNull();
  expect(document.querySelector('.expert-charge-editor[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('input[type="checkbox"]').checked).toBe(true);
  await act(async () => { change(document.querySelector('input[maxlength="100"]'), '分析报告'); change(document.querySelector('input[type="number"]'), '5'); });
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/billing/v1/resources/expert/expert-a/charge-points', expect.objectContaining({ name: '分析报告', credits: '5', enabled: true }));
  expect(container.textContent).toContain('cp_example');
  expect(container.textContent).toContain('已停用');
  await act(async () => { [...document.querySelectorAll('button')].find(b => b.textContent === '配置').click(); });
  await act(async () => { change(document.querySelector('input[type="number"]'), '8'); document.querySelector('input[type="checkbox"]').click(); });
  await act(async () => { document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.put).toHaveBeenCalledWith('/api/billing/v1/resources/expert/expert-a/charge-points/cp_example', expect.objectContaining({ credits: '8', enabled: true, version: 1 }));
  await act(async () => root.unmount()); container.remove();
});

test('keeps the form and reports server errors instead of pretending to save', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: [{ id: 'cp_existing', name: '原名称', description: '', credits: 2, version: 1, enabled: true }] } });
  API.put.mockResolvedValue({ data: { success: false, message: '配置已变更' } });
  const container = document.createElement('div'), root = createRoot(container); document.body.appendChild(container);
  await act(async () => root.render(<ExpertChargePoints expert={{ key: 'expert-a', name: '专家 A' }} onClose={() => {}} />));
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '配置').click());
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(showError).toHaveBeenCalledWith('配置已变更');
  expect(document.querySelector('form')).not.toBeNull();
  await act(async () => root.unmount()); container.remove();
});

test('Escape closes only the editor and restores the charge point list', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: [] } });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container), close = jest.fn();
  await act(async () => root.render(<ExpertChargePoints expert={{ key: 'expert-a', name: '专家 A' }} onClose={close} />));
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('添加扣分点')).click());
  expect(container.querySelector('[inert]')).not.toBeNull();
  await act(async () => document.querySelector('.expert-charge-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('.expert-charge-editor')).toBeNull();
  expect(container.querySelector('[inert]')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  await act(async () => root.unmount()); container.remove();
});
