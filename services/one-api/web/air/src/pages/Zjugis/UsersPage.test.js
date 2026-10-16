import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { UsersPage } from './index';
import { API } from '../../helpers';
import { fetchManagedRoles } from '../../helpers/roles';

jest.mock('../../helpers', () => ({
  API: { get: jest.fn(), put: jest.fn() },
  copy: jest.fn(),
}));
jest.mock('../../helpers/roles', () => ({
  fetchManagedRoles: jest.fn(async () => [{ role: 1, name: '普通成员' }]),
}));
jest.mock('../../components/RolePermissions', () => () => null);
jest.mock('../../components/CustomSelect', () => ({ children, ...props }) => (
  <select {...props}>{children}</select>
));
let container, root;
const user = {
  id: 2,
  username: 'xu001',
  display_name: '旧昵称',
  role: 1,
  phone: '',
  group: 'default',
};
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  fetchManagedRoles.mockResolvedValue([
    { role: 1, status: 1, name: '普通成员' },
  ]);
  API.get.mockImplementation(async (path) => ({
    data: { success: true, data: path === '/api/user/2' ? user : [user] },
  }));
  API.put.mockResolvedValue({ data: { success: true } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // ReactDOM roots require act; this does not use Testing Library's render helper.
  // eslint-disable-next-line testing-library/no-unnecessary-act, testing-library/no-render-in-setup
  await act(async () => root.render(<UsersPage />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const button = (text) =>
  [...container.querySelectorAll('button')].find(
    (node) => node.textContent === text
  );
async function click(text) {
  await act(async () => button(text).click());
}
async function change(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
test('asks for administrator password only after saving; cancellation does not submit', async () => {
  await click('编辑');
  expect(container.textContent).not.toContain(
    '管理员密码（修改敏感信息时需要）'
  );
  await click('保存用户');
  expect(container.textContent).toContain('当前管理员密码');
  expect(API.put).not.toHaveBeenCalled();
  const dialogs = container.querySelectorAll('.zjugis-modal');
  await act(async () =>
    [...dialogs[dialogs.length - 1].querySelectorAll('button')]
      .find((node) => node.textContent === '取消')
      .click()
  );
  expect(API.put).not.toHaveBeenCalled();
  expect(container.textContent).toContain('编辑用户');
});
test('submits edited name with confirmation password and keeps failed edits available', async () => {
  await click('编辑');
  const input = [...container.querySelectorAll('label')]
    .find((label) => label.textContent === '显示名称')
    .querySelector('input');
  await change(input, '新昵称');
  await click('保存用户');
  API.put.mockResolvedValueOnce({
    data: { success: false, message: '管理员密码错误' },
  });
  await change(
    container.querySelector('input[autocomplete="current-password"]'),
    'wrong'
  );
  await click('确认保存');
  expect(container.textContent).toContain('管理员密码错误');
  expect(input.value).toBe('新昵称');
  await change(
    container.querySelector('input[autocomplete="current-password"]'),
    'correct'
  );
  await click('确认保存');
  expect(API.put).toHaveBeenLastCalledWith(
    '/api/user/',
    expect.objectContaining({
      display_name: '新昵称',
      admin_password: 'correct',
    })
  );
  expect(container.textContent).not.toContain('确认保存用户');
});
