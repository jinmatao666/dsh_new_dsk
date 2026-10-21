/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopUpdates from './DesktopUpdates';
import VersionRelease from './index';
import { API, isRoot, showSuccess } from '../../helpers';

// Load the real primitives without Semi's unrelated Markdown/ESM barrel in the CRA Jest runtime.
jest.mock('@douyinfe/semi-ui', () => ({
  Button: jest.requireActual('@douyinfe/semi-ui/lib/cjs/button').default,
  Modal: jest.requireActual('@douyinfe/semi-ui/lib/cjs/modal').default,
  Space: jest.requireActual('@douyinfe/semi-ui/lib/cjs/space').default,
  Table: jest.requireActual('@douyinfe/semi-ui/lib/cjs/table').default,
  Tag: jest.requireActual('@douyinfe/semi-ui/lib/cjs/tag').default,
  TextArea: jest.requireActual('@douyinfe/semi-ui/lib/cjs/input/textarea').default,
  Typography: jest.requireActual('@douyinfe/semi-ui/lib/cjs/typography').default,
}));
jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn() }, isRoot: jest.fn(), showError: jest.fn(), showSuccess: jest.fn() }));
let container, root;
const record = { id: 'a'.repeat(32), platform: 'windows-x86_64', version: '1.2.0', size: 1048576, notes: '更新说明' };
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  isRoot.mockReturnValue(true);
  API.get.mockResolvedValue({ data: { success: true, data: { items: [record], channels: [], signing_configured: true } } });
  API.post.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('ordinary users never load the upload or publication interface', async () => {
  isRoot.mockReturnValue(false);
  await act(async () => root.render(<DesktopUpdates />));
  expect(container.textContent).toContain('仅系统超级管理员');
  expect(API.get).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

test('missing public key disables upload and publish without asking for a private key', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: { items: [record], channels: [], signing_configured: false } } });
  await act(async () => root.render(<DesktopUpdates />));
  expect(container.querySelector('input[type="file"]').disabled).toBe(true);
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '发布').disabled).toBe(true);
  expect(container.textContent).toContain('不要在此上传私钥');
});

test('upload uses multipart and remains separate from publication', async () => {
  await act(async () => root.render(<DesktopUpdates />));
  const version = container.querySelector('input[aria-label="版本号"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(version, '1.2.0');
    version.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new File(['signed release'], 'release.zip', { type: 'application/zip' })] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  const upload = [...container.querySelectorAll('button')].find(button => button.textContent === '上传并校验');
  await act(async () => upload.click());
  expect(API.post.mock.calls[0][0]).toBe('/api/desktop-updates');
  expect(API.post.mock.calls[0][1]).toBeInstanceOf(FormData);
  expect(API.post.mock.calls[0][1].get('version')).toBe('1.2.0');
  expect(API.post.mock.calls[0][1].get('platform')).toBe('windows-x86_64');
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(showSuccess).toHaveBeenCalledWith('更新包校验通过，已保存为待发布');
});

test('publication requires explicit confirmation and cancellation makes no request', async () => {
  await act(async () => root.render(<DesktopUpdates />));
  const publish = [...container.querySelectorAll('button')].find(button => button.textContent === '发布');
  act(() => publish.click());
  expect(API.post).not.toHaveBeenCalled();
  act(() => document.querySelector('button[aria-label="取消"]').click());
  expect(API.post).not.toHaveBeenCalled();
  act(() => publish.click());
  await act(async () => document.querySelector('button[aria-label="确认"]').click());
  expect(API.post).toHaveBeenCalledWith(`/api/desktop-updates/${record.id}/publish`);
  expect(showSuccess).toHaveBeenCalledWith('已发布，客户端将在检查更新时发现新版');
});

test('platform filtering changes records without changing the upload endpoint', async () => {
  const mac = { ...record, id: 'b'.repeat(32), platform: 'darwin-aarch64', version: '1.3.0' };
  API.get.mockResolvedValue({ data: { success: true, data: { items: [record, mac], channels: [], signing_configured: true } } });
  await act(async () => root.render(<DesktopUpdates />));
  const filter = container.querySelector('select[aria-label="筛选系统"]');
  expect(filter.closest('.release-list-heading')).not.toBeNull();
  const uploadSystem = container.querySelector('select[aria-label="操作系统"]');
  act(() => { uploadSystem.value = 'linux'; uploadSystem.dispatchEvent(new Event('change', { bubbles: true })); });
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new File(['signed release'], 'release.zip')] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  act(() => { filter.value = 'darwin'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody').textContent).toContain('macOSARM64');
  expect(container.querySelector('tbody').textContent).not.toContain('Windows');
  act(() => { filter.value = 'windows'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody').textContent).toContain('Windowsx64');
  expect(container.querySelector('tbody').textContent).not.toContain('macOS');
  expect(uploadSystem.value).toBe('linux');
  expect(container.textContent).toContain('release.zip');
  expect(API.post).not.toHaveBeenCalled();
});

test('release page has one upload area and no platform tabs or legacy entry', async () => {
  await act(async () => root.render(<VersionRelease />));
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(container.querySelector('a[href*="/legacy"]')).toBeNull();
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(container.textContent).toContain('不要上传 wanwei-buddy 普通安装包');
  expect(container.textContent).toContain('解压外层 ZIP');
});

test('system and architecture filters combine and return pagination to the first page', async () => {
  const items = Array.from({ length: 13 }, (_, index) => ({ ...record, id: `windows-${index}` }));
  items.push({ ...record, id: 'mac', platform: 'darwin-aarch64' });
  API.get.mockResolvedValue({ data: { success: true, data: { items, channels: [], signing_configured: true } } });
  await act(async () => root.render(<DesktopUpdates />));
  act(() => container.querySelector('button[aria-label="下一页"]').click());
  expect(container.querySelector('.zjugis-table-pagination').textContent).toContain('2 / 2');
  const system = container.querySelector('select[aria-label="筛选系统"]');
  const architecture = container.querySelector('select[aria-label="筛选架构"]');
  act(() => { system.value = 'darwin'; system.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('.zjugis-table-pagination').textContent).toContain('1 / 1');
  expect(container.querySelector('tbody').textContent).toContain('macOSARM64');
  act(() => { architecture.value = 'x86_64'; architecture.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody').textContent).toContain('暂无更新包');
  act(() => { architecture.value = 'aarch64'; architecture.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelector('tbody').textContent).toContain('macOSARM64');
  expect(container.querySelector('select[aria-label="架构"]').value).toBe('x86_64');
});

test('long notes have a dedicated detail view rather than expanding the table', async () => {
  await act(async () => root.render(<DesktopUpdates />));
  const view = [...container.querySelectorAll('button')].find(button => button.textContent === '查看');
  act(() => view.click());
  expect(document.querySelector('.release-full-notes').textContent).toBe(record.notes);
});

test('upload cannot omit version and same-version architectures remain separate rows', async () => {
  const mac = { ...record, platform: 'darwin-aarch64', id: 'b'.repeat(32) };
  const intel = { ...record, platform: 'darwin-x86_64', id: 'c'.repeat(32) };
  API.get.mockResolvedValue({ data: { success: true, data: { items: [mac, intel], channels: [], signing_configured: true } } });
  await act(async () => root.render(<DesktopUpdates />));
  expect(container.querySelectorAll('tbody tr').length).toBe(2);
  const upload = [...container.querySelectorAll('button')].find(button => button.textContent === '上传并校验');
  const file = container.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', { value: [new File(['mock'], 'release.zip')] });
  act(() => file.dispatchEvent(new Event('change', { bubbles: true })));
  expect(upload.disabled).toBe(true);
  const filter = container.querySelector('select[aria-label="筛选架构"]');
  act(() => { filter.value = 'aarch64'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelectorAll('tbody tr').length).toBe(1);
  expect(container.querySelector('tbody').textContent).toContain('ARM64');
});
