import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExpertCategory from './ExpertCategory';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('@douyinfe/semi-ui', () => ({ Modal: { confirm: jest.fn() } }));

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test('new and edited categories share the modal and preserve their save endpoints', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: [{ id: 1, name: '办公工具', description: '文件处理', status: 1, sort_order: 0 }] } });
  API.post.mockResolvedValue({ data: { success: true } });
  API.put.mockResolvedValue({ data: { success: true } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const click = async text => act(async () => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text).click());
  try {
    await act(async () => { root.render(<ExpertCategory />); });
    await click('＋ 新建分类');
    let dialog = container.querySelector('[role=dialog]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement.className).toBe('expert-admin-backdrop');
    expect(dialog.querySelector('h2').textContent).toBe('新建分类');
    await act(async () => {
      const input = dialog.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '新分类');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('保存分类');
    expect(API.post).toHaveBeenCalledWith('/api/expert/admin/categories', expect.objectContaining({ name: '新分类' }));
    expect(container.querySelector('[role=dialog]')).toBeNull();
    await click('编辑');
    dialog = container.querySelector('[role=dialog]');
    expect(dialog.querySelector('h2').textContent).toBe('编辑分类');
    expect(dialog.querySelector('input').value).toBe('办公工具');
    await click('保存分类');
    expect(API.put).toHaveBeenCalledWith('/api/expert/admin/categories/1', expect.objectContaining({ name: '办公工具' }));
    await click('＋ 新建分类');
    await click('取消');
    expect(container.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

test('categories show website counts without legacy expert or team counts', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: [{ id: 1, name: '办公工具', status: 1, expert_count: 99, web_expert_count: 2, team_count: 88 }] } });
  const container = document.createElement('div');
  const root = createRoot(container);
  // eslint-disable-next-line testing-library/no-unnecessary-act -- This is a raw React root, not a Testing Library render helper.
  await act(async () => { root.render(<ExpertCategory />); });
  expect([...container.querySelectorAll('.header span')].map(item => item.textContent)).toEqual(['分类名称', '描述', '专家数量', '状态', '操作']);
  expect(container.querySelector('.expert-category-row:not(.header)').children[2].textContent).toBe('2');
  expect(container.textContent).not.toContain('专家团');
  await act(async () => { root.unmount(); });
});
