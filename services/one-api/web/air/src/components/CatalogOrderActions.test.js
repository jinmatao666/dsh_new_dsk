import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CatalogOrderActions, { catalogDragProps, moveCatalogItem } from './CatalogOrderActions';
import { API, showError } from '../helpers';

jest.mock('../helpers', () => ({ API: { post: jest.fn() }, showError: jest.fn() }));
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test('arrow moves use neighboring identifiers and wait for the server before refreshing', async () => {
  const reload = jest.fn();
  API.post.mockResolvedValue({ data: { success: true } });
  const items = [{ id: 7 }, { id: 3 }, { id: 9 }];
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<CatalogOrderActions kind='skills' item={items[0]} items={items} reload={reload} />); });
  expect([...container.querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), disabled: button.disabled }))).toMatchInlineSnapshot(`
Array [
  Object {
    "disabled": true,
    "label": "上移",
  },
  Object {
    "disabled": false,
    "label": "下移",
  },
]
`);
  await act(async () => { container.querySelector('[aria-label="下移"]').click(); });
  expect(API.post).toHaveBeenCalledWith('/api/skill/admin/reorder', { key: '7', target_key: '3', after: true });
  expect(reload).toHaveBeenCalledTimes(1);
  API.post.mockResolvedValue({ data: { success: false, message: '保存失败' } });
  await moveCatalogItem('skills', items[0], items[1], false, reload);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(showError).toHaveBeenCalledWith('保存失败');
  await act(async () => { root.unmount(); });
});

test('category drag keeps its type and moves before or after the target row', async () => {
  API.post.mockResolvedValue({ data: { success: true } });
  const reload = jest.fn();
  const values = {};
  const dataTransfer = { types: ['application/x-catalog-order'], setData: (key, value) => { values[key] = value; }, getData: key => values[key] || '' };
  catalogDragProps('skill-categories', { id: 11 }, reload).onDragStart({ dataTransfer });
  const props = catalogDragProps('skill-categories', { id: 22 }, reload);
  await act(async () => {
    props.onDrop({ dataTransfer, preventDefault: jest.fn(), clientY: 80, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) } });
  });
  expect(API.post).toHaveBeenCalledWith('/api/skill-category/reorder', { key: '11', target_key: '22', after: true });
  expect(reload).toHaveBeenCalledTimes(1);
  values['application/x-catalog-order'] = '{broken';
  expect(() => props.onDrop({ dataTransfer, preventDefault: jest.fn() })).not.toThrow();
});
