/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopUpdates from './DesktopUpdates';
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
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new File(['signed release'], 'release.zip', { type: 'application/zip' })] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
  const upload = [...container.querySelectorAll('button')].find(button => button.textContent === '上传并校验');
  await act(async () => upload.click());
  expect(API.post.mock.calls[0][0]).toBe('/api/desktop-updates');
  expect(API.post.mock.calls[0][1]).toBeInstanceOf(FormData);
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
