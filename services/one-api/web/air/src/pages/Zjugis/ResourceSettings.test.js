/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ResourceSettings, { defaultResources, normalizeResources } from './ResourceSettings';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn() } }));
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  API.get.mockResolvedValue({ data: { success: true, data: { id: 'bundle-one', files: [{ name: 'demo.whl' }] } } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('source selection is exclusive and automatic detection exists only for proxy mode', async () => {
  const change = jest.fn();
  await act(async () => root.render(<ResourceSettings value={defaultResources} onChange={change} />));
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(container.textContent).toContain('1 个文件');
  act(() => container.querySelectorAll('input[type="radio"]')[1].click());
  expect(change).toHaveBeenCalledWith({ ...defaultResources, source: 'proxy' });
  await act(async () => root.render(<ResourceSettings value={{ ...defaultResources, source: 'proxy' }} onChange={change} />));
  expect(container.querySelector('input[type="file"]')).toBeNull();
  expect(container.textContent).toContain('读取指定网站并下载文件到桌面端工作区');
  act(() => container.querySelector('input[type="checkbox"]').click());
  expect(change).toHaveBeenLastCalledWith({ ...defaultResources, source: 'proxy', autoDetect: true });
});

test('uploads a ZIP without silently changing the selected source', async () => {
  const change = jest.fn();
  API.post.mockResolvedValue({ data: { success: true, data: { id: 'bundle-two', files: [{ name: 'new.whl' }] } } });
  await act(async () => root.render(<ResourceSettings value={defaultResources} onChange={change} />));
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { value: [new File(['zip'], 'wheels.zip', { type: 'application/zip' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(API.post.mock.calls[0][0]).toBe('/api/desktop-resources');
  expect(API.post.mock.calls[0][1].get('file').name).toBe('wheels.zip');
  expect(container.textContent).toContain('bundle-two');
  expect(change).not.toHaveBeenCalled();
});

test('managed tunnel retains the optional address without transport or bypass controls', async () => {
  const change = jest.fn();
  await act(async () => root.render(<ResourceSettings value={{ ...defaultResources, source: 'proxy' }} onChange={change} />));
  expect(container.querySelector('select')).toBeNull();
  expect(container.querySelector('input[type="url"]').required).toBe(false);
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.textContent).not.toContain('Squid');
  expect(container.textContent).not.toContain('额外直连');
  expect(container.textContent).toContain('本机和登录后台自动直连');
  expect(container.textContent).toContain('直接接入暂未开放');
});

test('resource edits remove hidden bypass settings and select managed transport', async () => {
  const change = jest.fn();
  const value = { ...defaultResources, source: 'proxy', transport: 'forward', bypassHosts: ['internal.example'] };
  await act(async () => root.render(<ResourceSettings value={value} onChange={change} />));
  act(() => container.querySelector('input[type="checkbox"]').click());
  expect(change).toHaveBeenCalledWith({ ...defaultResources, source: 'proxy', autoDetect: true });
  expect(value.bypassHosts).toEqual(['internal.example']);
});

test('normalization preserves the address and detection settings without mutating the input', () => {
  const value = { ...defaultResources, source: 'proxy', proxyUrl: 'https://backend.example', autoDetect: true, bypassHosts: ['internal.example'] };
  expect(normalizeResources(value)).toEqual({ ...defaultResources, source: 'proxy', proxyUrl: value.proxyUrl, autoDetect: true });
  expect(value.bypassHosts).toEqual(['internal.example']);
});
