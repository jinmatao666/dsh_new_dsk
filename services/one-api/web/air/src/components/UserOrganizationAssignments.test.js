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
    const change = (select, id) => { select.value = String(id); select.dispatchEvent(new Event('change', { bubbles: true })); };
    await act(async () => change(container.querySelector('select'), 1));
    expect(container.querySelectorAll('select')).toHaveLength(2);
    await act(async () => change(container.querySelectorAll('select')[1], 3));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent.includes('添加部门')).click());
    expect(selected).toEqual([2, 3]);
    expect(container.textContent).toContain('规划局 / 专班');
    await act(async () => container.querySelector('[aria-label="移除部门 2"]').click());
    expect(selected).toEqual([3]);
    expect(API.put).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; }
});
