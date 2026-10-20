/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ResourceSettings, { defaultResources } from './ResourceSettings';
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

test('managed tunnel defaults to the existing entry and standalone proxy remains selectable', async () => {
  const change = jest.fn();
  await act(async () => root.render(<ResourceSettings value={{ ...defaultResources, source: 'proxy' }} onChange={change} />));
  expect(container.querySelector('select').value).toBe('tunnel');
  expect(container.querySelector('input[type="url"]').required).toBe(false);
  expect(container.textContent).toContain('无需 Squid');
  const select = container.querySelector('select');
  act(() => { select.value = 'forward'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(change).toHaveBeenCalledWith({ ...defaultResources, source: 'proxy', transport: 'forward', proxyUrl: '' });
});
