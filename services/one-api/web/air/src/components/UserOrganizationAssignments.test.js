import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import UserOrganizationAssignments from './UserOrganizationAssignments';
import { API } from '../helpers';
jest.mock('../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() } }));

test('saves multiple affiliations or none without submitting account fields or a password', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockImplementation(async path => ({ data: { success: true, data: path.endsWith('memberships') ? { memberships: [{ user_id: 7, node_id: 1 }] } : [{ id: 1, name: '规划科' }, { id: 2, name: '专班' }] } }));
  API.put.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<UserOrganizationAssignments userId={7} />));
    const boxes = container.querySelectorAll('input[type=checkbox]');
    expect(boxes[0].checked).toBe(true);
    await act(async () => boxes[1].click());
    const save = () => [...container.querySelectorAll('button')].find(button => button.textContent === '保存组织归属');
    await act(async () => save().click());
    expect(API.put).toHaveBeenLastCalledWith('/api/government-organization/memberships', { user_id: 7, ids: [1, 2] });
    await act(async () => { boxes[0].click(); });
    await act(async () => { boxes[1].click(); });
    await act(async () => save().click());
    expect(API.put).toHaveBeenLastCalledWith('/api/government-organization/memberships', { user_id: 7, ids: [] });
    expect(container.querySelector('input[type=password]')).toBeNull();
  } finally { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; }
});
