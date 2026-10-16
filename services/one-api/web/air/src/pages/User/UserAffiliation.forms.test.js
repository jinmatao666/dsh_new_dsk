/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Exercises the existing controlled user drawers and their submitted API payloads. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AddUser from './AddUser';
import EditUser from './EditUser';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, isMobile: () => false, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('@douyinfe/semi-ui/lib/es/typography/title', () => ({ children }) => <h2>{children}</h2>);
jest.mock('@douyinfe/semi-ui', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  return {
    Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
    Input: ({ name, value, onChange }) => <input name={name} value={value || ''} onChange={event => onChange && onChange(event.target.value)} />,
    Select: Object.assign(() => null, { Option: () => null }),
    SideSheet: ({ children, footer }) => <div>{children}{footer}</div>,
    Spin: Wrapper, Space: Wrapper, Divider: Wrapper, Typography: { Text: Wrapper },
    Modal: ({ visible, children }) => visible ? <div>{children}</div> : null
  };
});

async function fill(container, name, value) {
  await act(async () => Simulate.change(container.querySelector(`input[name="${name}"]`), { target: { value } }));
}

test('creating a user sends optional unit and department', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.post.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AddUser visible refresh={() => {}} handleClose={() => {}} />));
    await fill(container, 'username', 'tester');
    await fill(container, 'password', 'Abc12345');
    await fill(container, 'unit_name', '单位甲');
    await fill(container, 'department_name', '部门甲');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '提交').click());
    expect(API.post).toHaveBeenCalledWith('/api/user/', expect.objectContaining({ unit_name: '单位甲', department_name: '部门甲' }));
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('editing affiliation preserves hidden group and permits clearing department', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockResolvedValue({ data: { success: true, data: { id: 7, username: 'tester', display_name: '', phone: '', group: 'custom', unit_name: '单位甲', department_name: '部门甲' } } });
  API.put.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EditUser editingUser={{ id: 7 }} visible refresh={() => {}} handleClose={() => {}} />));
    expect(container.textContent).not.toContain('分组');
    await fill(container, 'unit_name', '单位乙');
    await fill(container, 'department_name', '');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '提交').click());
    expect(API.put).toHaveBeenCalledWith('/api/user/', expect.objectContaining({ unit_name: '单位乙', department_name: '', group: 'custom' }));
    expect(container.textContent).not.toContain('管理员密码验证');
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
