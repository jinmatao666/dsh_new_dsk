/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access, testing-library/prefer-screen-queries -- Exercises the raw React root without Testing Library. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SkillTest from './index';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn() } }));
const skill = { id: 7, name: 'uploaded-skill', display_name: '用户上传技能', owner: '张三', version: '1.2', review_status: 'pending', visibility: 'public' };
const session = { id: 'a'.repeat(32), skill_id: 7, skill_name: skill.display_name, version: '1.2', reviewer_id: 1, reviewer: '审核人', status: 'idle', model: '默认模型', created_at: 1700000000, expires_at: 2100000000 };
let container, root, detail;
const response = data => Promise.resolve({ data: { success: true, data } });
const click = async text => {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const render = async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/skill/reviews/7/test']}><Routes><Route path='/skill/reviews/:id/test' element={<SkillTest />} /></Routes></MemoryRouter>));
};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('user', JSON.stringify({ id: 1 }));
  container = document.createElement('div'); root = createRoot(container);
  detail = { session, messages: [], events: [], outdated: false, can_operate: true };
  API.get.mockImplementation(url => {
    if (url.endsWith('/config')) return response({ enabled: true, model: '默认模型', retention_days: 7 });
    if (url.endsWith('/tests')) return response([]);
    if (url.endsWith('/files')) return response({ files: [] });
    if (url.includes('/skill-test/admin/')) return response(detail);
    return response(skill);
  });
  API.post.mockImplementation(() => response(session));
});
afterEach(async () => {
  await act(async () => root.unmount());
  delete global.IS_REACT_ACT_ENVIRONMENT;
  jest.clearAllMocks();
});

test('opening the test page does not allocate a container; explicit creation does', async () => {
  await render();
  expect(API.post).not.toHaveBeenCalled();
  expect(container.textContent).toContain('用户上传技能');
  await click('新建测试');
  expect(API.post).toHaveBeenCalledWith('/api/personal-skill/admin/7/tests', {});
  expect(container.querySelector('textarea').disabled).toBe(false);
});

test('approved submissions cannot start tests', async () => {
  API.get.mockImplementation(url => url.endsWith('/config') ? response({ enabled: true, model: '默认模型' }) : url.endsWith('/tests') ? response([]) : response({ ...skill, review_status: 'approved' }));
  await render();
  expect([...container.querySelectorAll('button')].find(node => node.textContent === '新建测试').disabled).toBe(true);
});

test('old snapshots are read-only and retained output is downloadable', async () => {
  detail = { ...detail, outdated: true, events: [{ kind: 'user', text: '转换文件' }, { kind: 'assistant', text: '已生成正式报告' }] };
  const original = API.get.getMockImplementation();
  API.get.mockImplementation(url => url.endsWith('/files') ? response({ files: [{ name: '报告.docx', size: 2048 }] }) : original(url));
  await render(); await click('新建测试');
  expect(container.querySelector('textarea').disabled).toBe(true);
  expect(container.textContent).toContain('旧版本');
  expect(container.textContent).toContain('报告.docx');
  expect(container.textContent).toContain('已生成正式报告');
});

test('send preserves a rejected draft and does not submit twice while running', async () => {
  await render(); await click('新建测试');
  const textarea = container.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, '请转换文档');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  API.post.mockRejectedValueOnce(new Error('模型额度不足'));
  await click('发送');
  expect(textarea.value).toBe('请转换文档');
  expect(container.textContent).toContain('模型额度不足');
  API.post.mockResolvedValueOnce({ data: { success: true, data: { status: 'running' } } });
  await click('发送');
  expect(textarea.disabled).toBe(true);
  expect(textarea.value).toBe('');
  expect(container.textContent).toContain('停止执行');
});

test('stop cancels the execution session rather than performing a review', async () => {
  detail = { ...detail, session: { ...session, status: 'running' } };
  await render(); await click('新建测试');
  await click('停止执行');
  expect(API.post).toHaveBeenCalledWith(`/api/skill-test/admin/${session.id}/stop`, {});
  expect(API.post.mock.calls.some(([url]) => url.includes('/review/'))).toBe(false);
});
