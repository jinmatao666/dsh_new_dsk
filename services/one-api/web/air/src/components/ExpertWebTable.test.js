import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExpertWebTable from './ExpertWebTable';
import { API, showError } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; jest.clearAllMocks(); jest.restoreAllMocks(); });

test('website expert editor exposes the card image and all four popup sections', async () => {
  API.put.mockResolvedValue({ data: { success: true } });
  API.get.mockImplementation(url => Promise.resolve({ data: { success: true, data: url.includes('categories') ? [{ id: 1, name: '办公工具' }] : [{
    key: 'meeting-minutes', name: '会议纪要', subtitle: '录音转写', category: '办公工具', provider: 'wanwei',
    workbench_url: 'https://example.com/', summary: '卡片简介', icon: 'meeting', tags: '["会议纪要"]',
    scenario: '例会整理', materials: '录音文件', detail_sections: '[]', footer_note: '生成正式纪要', published: true,
  }] } }));
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<ExpertWebTable />); });
  const edit = [...container.querySelectorAll('button')].find(button => button.textContent === '编辑');
  await act(async () => { edit.click(); });
  expect(container.querySelectorAll('.expert-web-section-grid fieldset')).toHaveLength(4);
  expect(container.textContent).toContain('专家主图标（卡片和介绍弹窗共用）');
  expect(container.textContent).toContain('弹窗底部说明');
  expect(container.querySelector('input[value="生成正式纪要"]')).not.toBeNull();
  const tags = [...container.querySelectorAll('label')].find(label => label.textContent.startsWith('标签（每行一个）')).querySelector('textarea');
  const draft = '会议纪要 \n\n材料完整性\n';
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(tags, draft);
    tags.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(tags.value).toBe(draft);
  const backdrop = container.querySelector('.expert-web-backdrop');
  await act(async () => {
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(tags.value).toBe(draft);
  const save = [...container.querySelectorAll('.expert-web-dialog button')].find(button => button.textContent === '保存');
  await act(async () => { save.click(); });
  const payload = API.put.mock.calls[0][1];
  expect(payload.footer_note).toBe('生成正式纪要');
  expect(JSON.parse(payload.tags)).toEqual(['会议纪要', '材料完整性']);
  expect(JSON.parse(payload.detail_sections)).toEqual([
    { title: '适用场景', subtitle: '场景应用', content: '例会整理' },
    { title: '需要准备的材料', subtitle: '材料要求', content: '录音文件' },
    { title: '本专家交付', subtitle: '输出内容', content: '卡片简介' },
    { title: '处理原则', subtitle: '能力范围', content: '' },
  ]);
  await act(async () => { root.unmount(); });
});

test('delete follows unpublish, requires confirmation, and refreshes the expert list', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  API.delete.mockResolvedValue({ data: { success: true } });
  let items = [{ key: 'test-expert', name: '测试专家', provider: 'wanwei', published: true }];
  API.get.mockImplementation(url => Promise.resolve({ data: { success: true, data: url.includes('categories') ? [] : items } }));
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<ExpertWebTable />); });
  const buttons = [...container.querySelectorAll('.actions > button')];
  expect(buttons.map(button => button.textContent)).toEqual(['编辑', '重置凭据', '下架', '删除']);
  const remove = buttons[3];
  await act(async () => { remove.click(); });
  expect(API.delete).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  items = [];
  await act(async () => { remove.click(); });
  expect(API.delete).toHaveBeenCalledWith('/api/expert-web/admin/test-expert');
  expect(container.querySelectorAll('.expert-web-list article')).toHaveLength(0);
  await act(async () => { root.unmount(); });
});

test('failed deletion reports the server error and keeps the expert', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  API.delete.mockRejectedValue({ response: { data: { message: '删除专家失败' } } });
  API.get.mockImplementation(url => Promise.resolve({ data: { success: true, data: url.includes('categories') ? [] : [{ key: 'test-expert', name: '测试专家', provider: 'wanwei' }] } }));
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => { root.render(<ExpertWebTable />); });
  const remove = [...container.querySelectorAll('.actions > button')].find(button => button.textContent === '删除');
  await act(async () => { remove.click(); });
  expect(showError).toHaveBeenCalledWith('删除专家失败');
  expect(container.querySelectorAll('.expert-web-list article')).toHaveLength(1);
  expect(remove.disabled).toBe(false);
  await act(async () => { root.unmount(); });
});
