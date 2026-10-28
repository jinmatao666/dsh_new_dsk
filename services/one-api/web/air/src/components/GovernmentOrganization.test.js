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

test('whole organization rows toggle members and batch editing saves direct memberships', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockImplementation(async path => ({ data: { success: true, data: path.endsWith('memberships') ? { users: [{ id: 8, username: 'zhang', display_name: '张三' }], memberships: [{ node_id: 2, user_id: 8 }] } : [{ id: 1, name: '规划局', parent_id: 0 }, { id: 2, name: '规划科', parent_id: 1 }] } }));
  API.put.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<GovernmentOrganization />));
    const label = name => [...container.querySelectorAll('.government-org-node-label')].find(button => button.textContent.includes(name));
    expect(container.querySelector('.government-org-member').textContent).toContain('张三');
    await act(async () => label('规划局').click());
    expect(container.querySelector('.government-org-member')).toBeNull();
    await act(async () => label('规划局').click());
    await act(async () => label('规划科').click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '批量管理成员').click());
    await act(async () => container.querySelector('.government-org-members-editor input[type=checkbox]').click());
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '保存成员').click());
    expect(API.put).toHaveBeenCalledWith('/api/government-organization/memberships', { node_id: 2, ids: [] });
    expect(container.querySelector('.government-org-tree-scroll')).not.toBeNull();
  } finally { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; }
});

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

test('distinguishes a failed load from an empty organization and supports retry', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockReset();
  API.get.mockRejectedValueOnce(new Error('网络请求失败'));
  API.get.mockResolvedValue({ data: { success: true, data: [] } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<GovernmentOrganization />));
    expect(container.querySelector('[role="alert"]').textContent).toContain('网络请求失败');
    expect(container.textContent).not.toContain('0 个节点');
    expect(container.textContent).not.toContain('还没有组织节点');
    const createButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('新建顶层组织'));
    expect(createButton.disabled).toBe(true);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重新加载').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('0 个节点');
    expect(container.textContent).toContain('还没有组织节点');
    expect(createButton.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
