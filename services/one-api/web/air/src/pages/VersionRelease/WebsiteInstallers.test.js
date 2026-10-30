/* eslint-disable testing-library/no-unnecessary-act -- Real ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WebsiteInstallers from './WebsiteInstallers';
import { API, showSuccess, showError } from '../../helpers';

jest.mock('@douyinfe/semi-ui', () => ({ Modal: jest.requireActual('@douyinfe/semi-ui/lib/cjs/modal').default }));
jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), defaults: { baseURL: '' } }, showSuccess: jest.fn(), showError: jest.fn() }));
let root, container, snapshot;
const endpoint = '/api/admin/website-installers';
const record = { id: 'a'.repeat(32), platform: 'windows-x64', version: '1.2.3', filename: 'app.exe', size: 2048, sha256: 'b'.repeat(64), notes: '安装说明' };
const uploadButton = () => container.querySelector('.release-upload-actions button');
const rowButton = name => [...container.querySelectorAll('tbody button')].find(button => button.textContent === name);
async function render() { await act(async () => root.render(<WebsiteInstallers />)); }
async function fill() {
  const input = container.querySelector('input[aria-label="官网安装包版本号"]');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1.2.3'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const file = new File(['MZ fake UI fixture'], 'app.exe');
  const picker = container.querySelector('input[type=file]');
  act(() => { Object.defineProperty(picker, 'files', { configurable: true, value: [file] }); picker.dispatchEvent(new Event('change', { bubbles: true })); });
  return file;
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  snapshot = { items: [], channels: [], max_bytes: 2147483648 };
  API.get.mockImplementation(async () => ({ data: { success: true, data: snapshot } }));
  API.post.mockResolvedValue({ data: { success: true } }); API.delete.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.resetAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('uploads the selected installer metadata, refreshes history, and does not automatically publish', async () => {
  await render(); const file = await fill();
  expect(uploadButton().disabled).toBe(false);
  API.post.mockImplementation(async (path, body, options) => { options.onUploadProgress({ loaded: 1, total: 1 }); snapshot = { ...snapshot, items: [record] }; return { data: { success: true } }; });
  await act(async () => uploadButton().click());
  expect(API.post).toHaveBeenCalledTimes(1);
  const [path, body] = API.post.mock.calls[0];
  expect(path).toBe(endpoint); expect(body.get('file')).toBe(file); expect(body.get('version')).toBe('1.2.3'); expect(body.get('platform')).toBe('windows-x64');
  expect(container.querySelector('tbody').textContent).toContain('待发布');
  expect(showSuccess).toHaveBeenCalledWith('安装包已保存为待发布，请核对后确认发布');
  expect(uploadButton().disabled).toBe(true);
});

test('withdrawal requires confirmation and removes the public download after refresh', async () => {
  snapshot = { ...snapshot, items: [record], channels: [{ platform: record.platform, release_id: record.id, published: true }] };
  await render();
  expect(container.querySelector('.installer-download')).not.toBeNull();
  act(() => rowButton('撤下').click());
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockImplementation(async () => {
    snapshot = { ...snapshot, channels: [{ platform: record.platform, release_id: record.id, published: false }] };
    return { data: { success: true } };
  });
  const confirm = document.querySelector('button[aria-label="确认"]');
  expect(confirm).toBeDefined();
  await act(async () => confirm.click());
  expect(API.post).toHaveBeenCalledWith(`${endpoint}/${record.id}/withdraw`);
  expect(container.querySelector('.installer-download')).toBeNull();
  expect(container.querySelector('tbody').textContent).toContain('已撤下');
});

test('switching target clears the file and excludes unsupported Windows ARM64', async () => {
  await render(); await fill();
  act(() => container.querySelectorAll('.installer-targets button')[1].click());
  expect(container.querySelector('input[type=file]').accept).toBe('.dmg');
  expect(uploadButton().disabled).toBe(true);
  expect(container.textContent).not.toContain('app.exe');
  act(() => container.querySelectorAll('.installer-targets button')[0].click());
  act(() => container.querySelector('button[aria-label="官网安装包架构"]').click());
  const menu = document.querySelector('[role=listbox]'); expect(menu.textContent).not.toContain('ARM64');
});

test('upload errors retain the file and metadata for retry', async () => {
  await render(); await fill(); API.post.mockRejectedValue(new Error('存储不可写'));
  await act(async () => uploadButton().click());
  expect(container.querySelector('[role=alert]').textContent).toContain('存储不可写');
  expect(container.textContent).toContain('app.exe'); expect(uploadButton().disabled).toBe(false);
});

test('publication needs confirmation, uses server state, and disables deletion of the public file', async () => {
  snapshot = { ...snapshot, items: [record] }; await render();
  act(() => rowButton('发布').click());
  expect(API.post).not.toHaveBeenCalled();
  act(() => document.querySelector('button[aria-label="取消"]').click());
  expect(API.post).not.toHaveBeenCalled();
  act(() => rowButton('发布').click());
  API.post.mockImplementation(async () => { snapshot = { ...snapshot, channels: [{ platform: record.platform, release_id: record.id, published: true }] }; return { data: { success: true } }; });
  await act(async () => document.querySelector('button[aria-label="确认"]').click());
  expect(API.post).toHaveBeenCalledWith(`${endpoint}/${record.id}/publish`);
  expect(rowButton('删除').disabled).toBe(true); expect(rowButton('撤下')).toBeTruthy();
  expect(container.querySelector('a.installer-download').getAttribute('href')).toBe(`/downloads/installers/${record.id}`);
});

test('failed publication keeps the confirmation open and deletion waits for confirmation', async () => {
  snapshot = { ...snapshot, items: [record] }; await render();
  act(() => rowButton('发布').click()); API.post.mockRejectedValue(new Error('校验失败'));
  await act(async () => document.querySelector('button[aria-label="确认"]').click());
  expect(showError).toHaveBeenCalledWith('校验失败'); expect(document.querySelector('[role=dialog]')).not.toBeNull();
  act(() => document.querySelector('button[aria-label="取消"]').click());
  act(() => rowButton('删除').click()); expect(API.delete).not.toHaveBeenCalled();
  API.delete.mockImplementation(async () => { snapshot = { ...snapshot, items: [] }; return { data: { success: true, message: '已删除' } }; });
  await act(async () => document.querySelector('button[aria-label="确认"]').click());
  expect(API.delete).toHaveBeenCalledWith(`${endpoint}/${record.id}`); expect(container.textContent).toContain('暂无官网安装包');
});

test('list failure blocks upload until a successful refresh', async () => {
  API.get.mockRejectedValueOnce(new Error('权限不足')); await render();
  expect(uploadButton().disabled).toBe(true); expect(container.querySelector('[role=alert]').textContent).toContain('权限不足');
  await act(async () => container.querySelector('.release-refresh').click());
  await fill();
  expect(uploadButton().disabled).toBe(false);
});
