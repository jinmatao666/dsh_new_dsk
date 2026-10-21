/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RolePermissions from './RolePermissions';
import { API, isRoot } from '../helpers';
import { fetchManagedRoles, removeManagedRole } from '../helpers/roles';

jest.mock('@douyinfe/semi-ui', () => ({ Modal: jest.requireActual('@douyinfe/semi-ui/lib/cjs/modal').default }));
jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, isRoot: jest.fn(), showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('../helpers/roles', () => ({ fetchManagedRoles: jest.fn(), cacheManagedRole: jest.fn(), removeManagedRole: jest.fn() }));
let container, root;
const button = (text) => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  isRoot.mockReturnValue(true);
  fetchManagedRoles.mockResolvedValue([
    { role: 1, name: '普通成员', is_builtin: true }, { role: 3, name: '业务成员' }, { role: 100, name: '超级管理员', is_builtin: true },
  ]);
  API.get.mockResolvedValue({ data: { success: true, data: [] } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('creation selects a type without exposing role codes and submits only once', async () => {
  await act(async () => root.render(<RolePermissions />));
  act(() => button('新建角色').click());
  expect(document.querySelector('input[type="number"]')).toBeNull();
  const select = document.querySelector('select');
  expect([...select.options].map(option => option.textContent)).toEqual(['普通成员', '管理员']);
  act(() => { select.value = 'admin'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const input = document.querySelector('input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '业务管理员');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let finish;
  API.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  act(() => { button('创建角色').click(); document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post.mock.calls[0][1]).toEqual({ role_type: 'admin', name: '业务管理员', description: '', permissions: { models: [] } });
  await act(async () => finish({ data: { success: false, message: '角色名称已存在' } }));
  expect(document.querySelector('[role="alert"]').textContent).toBe('角色名称已存在');
  expect(input.value).toBe('业务管理员');
});

test('delete requires confirmation, preserves in-use roles and updates cache on success', async () => {
  await act(async () => root.render(<RolePermissions />));
  expect(document.querySelectorAll('.role-delete')).toHaveLength(1);
  act(() => button('删除').click());
  expect(API.delete).not.toHaveBeenCalled();
  API.delete.mockResolvedValueOnce({ data: { success: false, message: '仍有用户使用' } });
  await act(async () => button('确认删除').click());
  expect(document.querySelector('[role="alert"]').textContent).toBe('仍有用户使用');
  expect(container.textContent).toContain('业务成员');
  API.delete.mockResolvedValueOnce({ data: { success: true } });
  await act(async () => button('确认删除').click());
  expect(API.delete).toHaveBeenLastCalledWith('/api/role/3');
  expect(removeManagedRole).toHaveBeenCalledWith(3);
  expect(container.textContent).not.toContain('业务成员');
});

test('ordinary administrators cannot choose the administrator type', async () => {
  isRoot.mockReturnValue(false);
  await act(async () => root.render(<RolePermissions />));
  act(() => button('新建角色').click());
  expect(document.querySelector('option[value="admin"]').disabled).toBe(true);
});

test('select all and invert operate on the complete model list and only save explicitly', async () => {
  API.get.mockResolvedValueOnce({ data: { success: true, data: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } });
  fetchManagedRoles.mockResolvedValueOnce([{ role: 3, name: '业务成员', permissions: { models: ['a', 'legacy'] } }]);
  await act(async () => root.render(<RolePermissions />));
  act(() => button('可用模型').click());
  const checkedNames = () => [...document.querySelectorAll('.zjugis-model-option.checked .zjugis-model-option-info span')].map(el => el.textContent);
  expect(checkedNames()).toEqual(['a']);
  act(() => button('反选').click());
  expect(checkedNames()).toEqual(['b', 'c']);
  act(() => button('反选').click());
  expect(checkedNames()).toEqual(['a']);
  act(() => button('全选').click());
  expect(checkedNames()).toEqual(['a', 'b', 'c']);
  act(() => button('全选').click());
  act(() => button('反选').click());
  expect(checkedNames()).toEqual([]);
  expect(API.put).not.toHaveBeenCalled();
  act(() => button('取消').click());
  act(() => button('可用模型').click());
  expect(checkedNames()).toEqual(['a']);
  act(() => button('全选').click());
  API.put.mockImplementationOnce(async (url, body) => ({ data: { success: true, data: { role: 3, ...body } } }));
  await act(async () => button('保存').click());
  expect(API.put).toHaveBeenCalledTimes(1);
  expect(API.put.mock.calls[0][1].permissions.models).toEqual(['a', 'legacy', 'b', 'c']);
});

test('bulk selection is disabled while loading and when the model list is empty', async () => {
  let finish;
  API.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<RolePermissions />));
  act(() => button('可用模型').click());
  expect(button('全选').disabled).toBe(true);
  expect(button('反选').disabled).toBe(true);
  await act(async () => finish({ data: { success: true, data: [] } }));
  expect(button('全选').disabled).toBe(true);
  expect(button('反选').disabled).toBe(true);
});
