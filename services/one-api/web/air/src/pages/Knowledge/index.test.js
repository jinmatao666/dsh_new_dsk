/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import KnowledgeLibrary from './index';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));

const categories = [
  { id: 1, name: '测绘规范', type: 'common', require_auth: false },
];
const libraries = [
  { id: 1, name: '测绘标准规范合集', description: '关于测绘标准规范合集的详细知识资源集合', kind: 'common', category_id: 1, shelf: 'published', tags: '政策法规,林草资源', owner_username: 'Root User', visit_count: 12, daily_usage: 3, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
  { id: 2, name: '个人笔记', description: '个人资料', kind: 'personal', shelf: 'published', tags: '', owner_username: 'alice', owner_user_id: 2, visit_count: 0, daily_usage: 0, updated_at: '2024-01-02T00:00:00Z', created_at: '2024-01-02T00:00:00Z' }
];
const documents = [
  { id: 'doc1', name: '测绘标准规范合集_文件1.pdf', size: 11.3 * 1024 * 1024, create_time: 1748833920, chunk_count: 7, summary: '这是测绘标准规范合集文件1的文档摘要' }
];
const documentPage = { items: documents, total: 1, page: 1, page_size: 20 };

function documentsResponse(url) {
  if (url === '/api/knowledge-admin/categories') return { data: { success: true, data: categories } };
  if (url === '/api/knowledge-admin/bases') return { data: { success: true, data: libraries } };
  if (String(url).includes('/documents?') || /\/documents$/.test(String(url))) {
    return { data: { success: true, data: documentPage } };
  }
  return { data: { success: true, data: documents } };
}

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = jest.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  API.get.mockImplementation(url => Promise.resolve(documentsResponse(url)));
  API.post.mockResolvedValue({ data: { success: true, data: { id: 9 } } });
  API.put.mockResolvedValue({ data: { success: true, data: {} } });
  API.delete.mockResolvedValue({ data: { success: true, message: '已删除' } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

function button(text) {
  const items = [...container.querySelectorAll('button')];
  return items.find(item => item.textContent.trim() === text)
    || items.find(item => item.textContent.includes(text));
}

test('sort listbox preserves the selected value and creates a personal library', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  expect(container.querySelector('select')).toBeNull();
  const sort = container.querySelector('[aria-label="排序"]');
  act(() => { sort.click(); });
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  act(() => { document.querySelector('[role="option"][value="asc"]').click(); });
  expect(sort.textContent).toContain('按时间升序');
  act(() => { button('新建知识库').click(); });
  expect(container.textContent).toContain('将创建为个人知识库');
  expect(container.querySelector('[aria-label="知识库类型"]')).toBeNull();
  const name = container.querySelector('.knowledge-modal input');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, '个人测试');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({ kind: 'personal', name: '个人测试' }));
});

test('knowledge catalog filters scopes and opens the file list', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('个人笔记');
  expect(container.textContent).not.toContain('已上架');
  expect(container.textContent).not.toContain('下架');
  expect(button('个人知识库').textContent).toContain('1');
  expect(button('测绘规范').textContent).toContain('1');
  expect(button('共性知识库')).toBeUndefined();
  expect(button('共享知识库')).toBeUndefined();
  await act(async () => { button('测绘规范').click(); });
  expect(container.textContent).toContain('测绘标准规范合集');
  expect(container.textContent).not.toContain('个人笔记');
  expect(container.textContent).toContain('创建人 Root User');
  expect(container.textContent).toContain('文件量');
  expect(container.textContent).toContain('用户访问量 12');
  expect(container.textContent).toContain('每天使用量 3');
  await act(async () => { button('编辑').click(); });
  expect(container.querySelector('#dsh-knowledge-edit-title')?.textContent).toBe('编辑知识库');
  const editModal = container.querySelector('.knowledge-modal');
  expect(editModal.textContent).not.toContain('用户访问量');
  expect(editModal.textContent).not.toContain('每天使用量');
  expect(editModal.textContent).not.toContain('文件量');
  const editName = container.querySelector('.knowledge-modal input[maxlength="128"]');
  const setEditValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setEditValue.call(editName, '测绘标准规范合集修订');
    editName.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.put).toHaveBeenCalledWith('/api/knowledge-admin/bases/1', expect.objectContaining({
    name: '测绘标准规范合集修订',
    description: '关于测绘标准规范合集的详细知识资源集合',
    tags: '政策法规,林草资源',
  }));
  await act(async () => { button('文件清单').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('测绘标准规范合集 - 文件清单');
  expect(container.textContent).toContain('测绘标准规范合集_文件1.pdf');
  expect(container.textContent).toContain('7');
  expect(container.textContent).toContain('这是测绘标准规范合集文件1的文档摘要');
  expect(container.textContent).toContain('共 1 条，每页 20 条');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/bases/1/documents?page=1&page_size=20'));
  const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  API.get.mockImplementation(url => {
    if (String(url).endsWith('/file')) {
      return Promise.resolve({ data: pdfBlob, headers: { 'content-type': 'application/pdf' } });
    }
    if (String(url).endsWith('/chunks')) {
      return Promise.resolve({ data: { success: true, data: [{ id: 'c1', content: '已解析切片一' }, { id: 'c2', content: '已解析切片二' }] } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  const searchInput = container.querySelector('input[placeholder="搜索文件名称..."]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(searchInput, '测绘');
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { button('搜索').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('keywords=%E6%B5%8B%E7%BB%98'));
  await act(async () => { button('浏览').click(); });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc1/file', { responseType: 'blob' });
  expect(container.querySelector('.knowledge-viewer iframe')).toBeTruthy();
  await act(async () => { button('切片').click(); });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc1/chunks');
  expect(container.textContent).toContain('测绘标准规范合集_文件1.pdf - 切片列表');
  expect(container.textContent).toContain('已解析切片一');
  expect(container.textContent).toContain('已解析切片二');
  await act(async () => { button('返回').click(); });
  expect(button('新建知识库')).toBeTruthy();
  await act(async () => { button('新建知识库').click(); });
  const name = container.querySelector('input[placeholder="请输入知识库名称"]');
  await act(async () => {
    setValue.call(name, '协作资料');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = container.querySelector('form');
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({ name: '协作资料', kind: 'common' }));
});

test('uploads one file, shows parse progress, and opens the new library', async () => {
  const timers = [];
  const interval = jest.spyOn(window, 'setInterval').mockImplementation((fn, delay) => {
    timers.push({ fn, delay });
    return timers.length;
  });
  const clear = jest.spyOn(window, 'clearInterval').mockImplementation(() => {});
  const parsing = {
    items: [{ id: 'doc-run', name: '说明.pdf', size: 2048, create_time: 1748833920, chunk_count: 0, run: '1', progress: 0.4, summary: '' }],
    total: 1, page: 1, page_size: 20,
  };
  API.get.mockImplementation(url => {
    if (String(url).includes('/documents?')) return Promise.resolve({ data: { success: true, data: parsing } });
    return Promise.resolve(documentsResponse(url));
  });
  try {
    await act(async () => { root.render(<KnowledgeLibrary />); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { button('测绘规范').click(); });
    await act(async () => { button('文件清单').click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('解析中 40%');
    expect(container.textContent).toContain('一次上传一个文件，不超过 20MB');
    const input = container.querySelector('input[type="file"]');
    expect(input.multiple).toBe(false);
    expect(input.hidden).toBe(false);
    expect(getComputedStyle(input).display).not.toBe('none');
    const upload = [...container.querySelectorAll('button')].find(item => item.textContent.includes('上传文件'));
    const clicked = jest.spyOn(input, 'click').mockImplementation(() => {});
    await act(async () => { upload.click(); });
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
    const file = new File(['hello'], '说明.txt', { type: 'text/plain' });
    API.post.mockClear();
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
    expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents', expect.any(FormData));
    expect(API.post.mock.calls.at(-1)[1].get('file').name).toBe('说明.txt');

    const oversized = new File(['x'], 'big.bin');
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    API.post.mockClear();
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [oversized] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('文件不能超过 20MB');
    expect(API.post).not.toHaveBeenCalled();

    const poll = timers.find(item => item.delay === 2500);
    expect(poll).toBeTruthy();
    const calls = API.get.mock.calls.length;
    await act(async () => { poll.fn(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(API.get.mock.calls.length).toBeGreaterThan(calls);

    parsing.items = [{ id: 'doc-fail', name: '失败.pdf', size: 100, create_time: 1748833920, chunk_count: 0, run: 'FAIL', progress: 0, summary: '' }];
    await act(async () => { poll.fn(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('解析失败');
    API.post.mockClear();
    await act(async () => { button('重新解析').click(); });
    for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
    expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc-fail/parse');

    await act(async () => { button('返回').click(); });
    await act(async () => { button('新建知识库').click(); });
    const name = container.querySelector('input[placeholder="请输入知识库名称"]');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setValue.call(name, '协作资料');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('协作资料 - 文件清单');
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

test('reviews a pending subscription application from the workbench audit list', async () => {
  API.get.mockImplementation(url => {
    if (String(url).startsWith('/api/knowledge-admin/subscription-applications')) {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            items: [{
              id: 11,
              knowledge_base_id: 9,
              applicant_user_id: 3,
              status: 'pending',
              knowledge_base_name: '地方法规知识库',
              category_name: '法律',
              applicant_username: 'alice',
              owner_username: 'bob',
              created_at: '2026-10-23T08:00:00Z',
            }],
            total: 1,
            page: 1,
            page_size: 20,
          },
        },
      });
    }
    return Promise.resolve(documentsResponse(url));
  });
  API.post.mockResolvedValue({ data: { success: true, data: { id: 11, status: 'approved' } } });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('订阅审核').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('订阅审核');
  expect(container.textContent).toContain('alice');
  expect(container.textContent).toContain('地方法规知识库');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/subscription-applications?page=1&page_size=20&status=pending'));
  await act(async () => { button('审核').click(); });
  expect(container.textContent).toContain('同意');
  expect(container.textContent).toContain('不同意');
  await act(async () => { button('同意').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/subscription-applications/11/review', { decision: 'approve' });
});

test('creates a category beside personal and files the next library under it', async () => {
  const stored = [];
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored } });
    return Promise.resolve(documentsResponse(url));
  });
  API.post.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories') {
      const row = { id: 4, name: body.name, type: body.type, require_auth: body.require_auth };
      stored.push(row);
      return Promise.resolve({ data: { success: true, data: row } });
    }
    return Promise.resolve({ data: { success: true, data: { id: 9, name: body.name, kind: body.kind, category_id: body.category_id } } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  act(() => { button('新建知识库分类').click(); });
  act(() => { container.querySelector('[aria-label="分类类型"]').click(); });
  act(() => { document.querySelector('[role="option"][value="authorized"]').click(); });
  expect(container.textContent).toContain('订阅后可见');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const name = container.querySelector('input[placeholder="请输入分类名称"]');
  act(() => {
    setValue.call(name, '部门规范');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/categories', { name: '部门规范', type: 'shared', require_auth: true });
  const created = button('部门规范');
  expect(created).toBeTruthy();
  expect(created.getAttribute('aria-selected')).toBe('true');
  expect(button('个人知识库').compareDocumentPosition(created) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  act(() => { button('新建知识库').click(); });
  expect(container.textContent).toContain('将创建到当前分类');
  const libraryName = container.querySelector('input[placeholder="请输入知识库名称"]');
  await act(async () => {
    setValue.call(libraryName, '规范汇编');
    libraryName.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({ name: '规范汇编', kind: 'shared', category_id: 4 }));
});
