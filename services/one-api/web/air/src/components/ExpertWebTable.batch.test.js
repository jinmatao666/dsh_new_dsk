/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-render-in-setup -- These tests use ReactDOM roots, not Testing Library render utilities. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExpertWebTable from './ExpertWebTable';
import { API, showError } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('./CustomSelect', () => function Select(props) { return <select {...props} />; });

let container, root, items;
const button = text => [...container.querySelectorAll('button')].find(item => item.textContent === text);
const click = async element => act(async () => { element.click(); });
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  items = [
    { key: 'a', name: '专家甲', category: '规划', published: false },
    { key: 'b', name: '专家乙', category: '规划', published: true },
    { key: 'c', name: '专家丙', category: '', published: false },
  ];
  API.get.mockImplementation(url => Promise.resolve({ data: { success: true, data: url.includes('categories') ? [{ name: '规划' }, { name: '空分类' }] : items } }));
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ExpertWebTable />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.resetAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('category/status/search intersect; changing filters clears selection and all selects only visible rows', async () => {
  await click(button('批量管理'));
  const filter = container.querySelector('[aria-label="筛选专家分类"]');
  await act(async () => { filter.value = 'category:规划'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelectorAll('article')).toHaveLength(2);
  await click(container.querySelector('[aria-label="选择专家甲"]'));
  await click(button('反选'));
  expect(container.querySelector('[aria-label="选择专家甲"]').checked).toBe(false);
  expect(container.querySelector('[aria-label="选择专家乙"]').checked).toBe(true);
  expect(container.querySelector('[aria-label="全选当前结果"]').indeterminate).toBe(true);
  await click(container.querySelector('[aria-label="全选当前结果"]'));
  expect(container.querySelectorAll('.expert-row-check:checked')).toHaveLength(2);
  await click(button('反选'));
  expect(container.querySelectorAll('.expert-row-check:checked')).toHaveLength(0);
  await click(button('反选'));
  expect(container.querySelectorAll('.expert-row-check:checked')).toHaveLength(2);
  const status = container.querySelector('[aria-label="筛选上架状态"]');
  await act(async () => { status.value = 'draft'; status.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.querySelectorAll('article')).toHaveLength(1);
  expect(container.querySelectorAll('.expert-row-check:checked')).toHaveLength(0);
  await act(async () => root.render(<ExpertWebTable keyword='专家丙' />));
  expect(container.querySelectorAll('article')).toHaveLength(0);
  expect(button('反选').disabled).toBe(true);
});

test('batch publish skips published experts and retains failures for retry', async () => {
  API.put.mockImplementation(async (url) => {
    if (url.includes('/c/')) throw new Error('没有权限');
    items = items.map(item => item.key === 'a' ? { ...item, published: true } : item);
    return { data: { success: true } };
  });
  await click(button('批量管理'));
  await click(container.querySelector('[aria-label="全选当前结果"]'));
  await click(button('批量上架'));
  expect(container.querySelector('[role="dialog"]').textContent).toContain('2');
  await click(button('确认上架'));
  expect(API.put.mock.calls.map(args => args[0])).toEqual(['/api/expert-web/admin/a/publish', '/api/expert-web/admin/c/publish']);
  expect(container.querySelector('[role="alert"]').textContent).toContain('专家丙：没有权限');
  expect(container.querySelectorAll('.expert-row-check:checked')).toHaveLength(1);
  expect(showError).toHaveBeenCalledWith('1 位专家操作失败，请查看列表并重试');
});

test('batch delete requires confirmation, cancellation sends nothing, and confirmed deletion removes selected rows only', async () => {
  API.delete.mockImplementation(async url => { items = items.filter(item => !url.endsWith('/' + item.key)); return { data: { success: true } }; });
  await click(button('批量管理'));
  await click(container.querySelector('[aria-label="选择专家甲"]'));
  await click(button('批量删除'));
  expect(API.delete).not.toHaveBeenCalled();
  await click(button('取消'));
  expect(API.delete).not.toHaveBeenCalled();
  await click(button('批量删除'));
  await click(button('确认删除'));
  expect(API.delete).toHaveBeenCalledTimes(1);
  expect(API.delete).toHaveBeenCalledWith('/api/expert-web/admin/a');
  expect(container.querySelectorAll('article')).toHaveLength(2);
});
