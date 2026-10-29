/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import UserOrganizationAssignments from './UserOrganizationAssignments';
import { API } from '../helpers';
jest.mock('../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() } }));

test('selects a department level by level and adds another affiliation', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockImplementation(async path => ({ data: { success: true, data: path.endsWith('memberships')
    ? { memberships: [{ user_id: 7, node_id: 2 }] }
    : [{ id: 1, parent_id: 0, name: '规划局' }, { id: 2, parent_id: 1, name: '规划科' }, { id: 3, parent_id: 1, name: '专班' }] } }));
  const container = document.createElement('div'); const root = createRoot(container);
  let selected = [];
  const ready = jest.fn();
  const onChange = ids => { selected = ids; root.render(render()); };
  const render = () => <UserOrganizationAssignments userId={7} value={selected} onChange={onChange} onReady={ready} />;
  try {
    await act(async () => root.render(render()));
    expect(selected).toEqual([2]);
    expect(ready).toHaveBeenLastCalledWith(true);
    await act(async () => container.querySelector('[aria-label="选择部门"]').click());
    expect(container.querySelectorAll('.department-trigger')).toHaveLength(1);
    expect(container.querySelectorAll('select')).toHaveLength(0);
    await act(async () => container.querySelector('[aria-label="展开 规划局"]').click());
    expect(selected).toEqual([2]);
    await act(async () => container.querySelector('[aria-label="收起 规划局"]').click());
    expect(container.querySelector('[aria-label="选择 专班"]')).toBeNull();
    await act(async () => container.querySelector('[aria-label="展开 规划局"]').click());
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    await act(async () => container.querySelector('[aria-label="选择 专班"]').click());
    expect(container.querySelector('.department-dropdown')).toBeNull();
    expect(selected).toEqual([2, 3]);
    expect(container.textContent).toContain('规划局 / 专班');
    await act(async () => container.querySelector('[aria-label="移除部门 2"]').click());
    expect(selected).toEqual([3]);
    await act(async () => container.querySelector('[aria-label="选择部门"]').click());
    expect(container.querySelector('[aria-label="选择 专班"]').getAttribute('aria-pressed')).toBe('true');
    await act(async () => container.querySelector('[aria-label="选择 专班"]').click());
    expect(selected).toEqual([]);
    expect(API.put).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; }
});

 test('keeps existing affiliations on API failure and recovers through retry', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let fail = true;
  API.get.mockImplementation(async path => {
    if (fail) throw { response: { status: 403 } };
    return { data: { success: true, data: path.endsWith('memberships') ? { memberships: [] } : [] } };
  });
  const container = document.createElement('div'); const root = createRoot(container);
  const onChange = jest.fn(); const ready = jest.fn();
  try {
    await act(async () => root.render(<UserOrganizationAssignments userId={7} value={[2]} onChange={onChange} onReady={ready} />));
    expect(container.textContent).toContain('没有读取组织架构的权限');
    expect(onChange).not.toHaveBeenCalled();
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-label="选择部门"]').disabled).toBe(true);
    fail = false;
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重新加载').click());
    expect(onChange).toHaveBeenCalledWith([]);
    expect(ready).toHaveBeenLastCalledWith(true);
    await act(async () => container.querySelector('[aria-label="选择部门"]').click());
    expect(container.textContent).toContain('暂无组织架构');
  } finally { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; }
});
