/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GovernmentOrganization from './GovernmentOrganization';
import { API } from '../helpers';

jest.mock('../helpers', () => ({
  API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  isRoot: () => true,
  showError: jest.fn(),
  showSuccess: jest.fn(),
}));

test('creates a top-level node and a child without prescribed hierarchy levels', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const nodes = [];
  API.get.mockImplementation(async () => ({ data: { success: true, data: [...nodes] } }));
  API.post.mockImplementation(async (url, payload) => {
    const node = { id: nodes.length + 1, ...payload };
    nodes.push(node);
    return { data: { success: true, data: node } };
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const click = async (text) => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text).click());
  const change = async (input, value) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(<GovernmentOrganization />));
    await click('新建顶层组织');
    await change(container.querySelector('input[placeholder*="杭州市"]'), '浙政钉');
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(API.post.mock.calls[0][1]).toEqual({ parent_id: 0, name: '浙政钉', kind: '', sort_order: 0 });
    await click('添加下级');
    await change(container.querySelector('input[placeholder*="杭州市"]'), '杭州市');
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(API.post.mock.calls[1][1]).toEqual({ parent_id: 1, name: '杭州市', kind: '', sort_order: 0 });
    expect(container.textContent).toContain('浙政钉 / 杭州市');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
