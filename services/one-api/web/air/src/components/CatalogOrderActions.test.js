import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CatalogOrderActions, { catalogDragProps, moveCatalogItem } from './CatalogOrderActions';
import { API, showError } from '../helpers';

jest.mock('../helpers', () => ({ API: { post: jest.fn() }, showError: jest.fn() }));
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test('single handle supports keyboard moves and reports failed saves without reloading', async () => {
  API.post.mockResolvedValue({ data: { success: true } });
  const reload = jest.fn();
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<CatalogOrderActions kind='skills' item={{ id: 7 }} items={[{ id: 7 }, { id: 3 }]} reload={reload} />); });
  expect(container.querySelectorAll('button')).toHaveLength(1);
  const handle = container.querySelector('[aria-label="拖动排序"]');
  expect(handle.draggable).toBe(true);
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
  expect(API.post).not.toHaveBeenCalled();
  await act(async () => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/skill/admin/reorder', { key: '7', target_key: '3', after: true });
  expect(reload).toHaveBeenCalledTimes(1);
  API.post.mockResolvedValue({ data: { success: false, message: '保存失败' } });
  await moveCatalogItem('skills', { id: 7 }, { id: 3 }, false, reload);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(showError).toHaveBeenCalledWith('保存失败');
  await act(async () => { root.unmount(); });
});

test.each([
  ['skills', '/api/skill/admin/reorder'],
  ['experts', '/api/expert-web/admin/reorder'],
  ['skill-categories', '/api/skill-category/reorder'],
  ['expert-categories', '/api/expert/admin/categories/reorder'],
])('only the handle starts a %s drag and both drop positions persist', async (kind, endpoint) => {
  API.post.mockResolvedValue({ data: { success: true } });
  const reload = jest.fn();
  const values = {};
  const dataTransfer = { types: ['application/x-catalog-order'], setData: (key, value) => { values[key] = value; }, getData: key => values[key] || '' };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<div {...catalogDragProps(kind, { id: 11 }, reload)}><CatalogOrderActions kind={kind} item={{ id: 11 }} items={[{ id: 11 }, { id: 22 }]} reload={reload} /></div>); });
  const row = container.firstChild;
  expect(row.draggable).toBe(false);
  const start = new Event('dragstart', { bubbles: true });
  Object.defineProperty(start, 'dataTransfer', { value: dataTransfer });
  await act(async () => { container.querySelector('button').dispatchEvent(start); });
  expect(row.dataset.catalogDragging).toBe('true');
  const props = catalogDragProps(kind, { id: 22 }, reload);
  const target = document.createElement('div');
  target.getBoundingClientRect = () => ({ top: 0, height: 100 });
  const event = { dataTransfer, preventDefault: jest.fn(), clientY: 80, currentTarget: target };
  props.onDragOver(event);
  expect(target.dataset.catalogDrop).toBe('after');
  await act(async () => { props.onDrop(event); });
  expect(API.post).toHaveBeenLastCalledWith(endpoint, { key: '11', target_key: '22', after: true });
  expect(target.dataset.catalogDrop).toBeUndefined();
  await act(async () => { props.onDrop({ ...event, clientY: 20 }); });
  expect(API.post).toHaveBeenLastCalledWith(endpoint, { key: '11', target_key: '22', after: false });
  expect(reload).toHaveBeenCalledTimes(2);
  API.post.mockClear();
  values['application/x-catalog-order'] = JSON.stringify({ kind: 'another-list', key: '11' });
  props.onDrop(event);
  values['application/x-catalog-order'] = '{broken';
  expect(() => props.onDrop(event)).not.toThrow();
  expect(API.post).not.toHaveBeenCalled();
  await act(async () => { container.querySelector('button').dispatchEvent(new Event('dragend', { bubbles: true })); });
  expect(row.dataset.catalogDragging).toBeUndefined();
  await act(async () => { root.unmount(); });
  container.remove();
});
