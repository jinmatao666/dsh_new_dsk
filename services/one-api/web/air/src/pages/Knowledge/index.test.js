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
const users = [
  { id: 2, username: 'alice', display_name: '爱丽丝', department_name: '', created_at: '2024-01-02T00:00:00Z', status: 1 },
  { id: 8, username: 'chen', display_name: '陈静', department_name: '办公室', created_at: '2019-05-20T00:00:00Z', status: 1 },
];

function documentsResponse(url) {
  if (String(url).startsWith('/api/user/')) return { data: { success: true, data: users } };
  if (url === '/api/knowledge-admin/categories') return { data: { success: true, data: categories } };
  if (url === '/api/knowledge-admin/bases') return { data: { success: true, data: libraries } };
  if (String(url).startsWith('/api/knowledge-admin/subscription-applications')) {
    return { data: { success: true, data: { items: [], total: 0, page: 1, page_size: 1 } } };
  }
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
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('全部人员');
  expect(container.querySelector('select')).toBeNull();
  await act(async () => { button('测绘规范').click(); });
  const sort = container.querySelector('[aria-label="排序"]');
  act(() => { sort.click(); });
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  act(() => { document.querySelector('[role="option"][value="asc"]').click(); });
  expect(sort.textContent).toContain('按时间升序');
  await act(async () => { button('个人知识库').click(); });
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
  // Strict Mode re-runs effects once; stats must still resolve (not stick on "…").
  await act(async () => { root.render(<React.StrictMode><KnowledgeLibrary /></React.StrictMode>); });
  for (let i = 0; i < 12; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('全部人员');
  expect(container.textContent).toContain('爱丽丝');
  expect(container.textContent).not.toContain('个人笔记');
  expect(container.textContent).not.toContain('已上架');
  expect(container.textContent).not.toContain('下架');
  expect(button('个人知识库').textContent).toContain('1');
  expect(button('测绘规范').textContent).toContain('1');
  expect(button('共性知识库')).toBeUndefined();
  expect(button('共享知识库')).toBeUndefined();
  await act(async () => { button('测绘规范').click(); });
  expect(container.textContent).toContain('测绘标准规范合集');
  expect(container.textContent).not.toContain('个人笔记');
  expect(container.textContent).toContain('创建人');
  expect(container.textContent).toContain('Root User');
  expect(container.textContent).toContain('文件量');
  expect(container.textContent).toContain('1个');
  expect(container.textContent).toContain('大小');
  expect(container.textContent).toContain('11.3MB');
  expect(container.textContent).toContain('用户访问量');
  expect(container.textContent).toContain('12');
  expect(container.textContent).toContain('每天使用量');
  expect(container.textContent).toContain('3');
  const meta = container.querySelector('.knowledge-meta');
  expect(meta.querySelector('.knowledge-meta-label').textContent).toBe('创建人');
  expect(meta.querySelector('.knowledge-meta-value').textContent).toBe('Root User');
  expect(meta.textContent).not.toContain('…');
  expect(button('编辑')).toBeUndefined();
  expect(button('删除')).toBeUndefined();
  await act(async () => { container.querySelector('[aria-label="更多操作"]').click(); });
  expect(button('编辑')).toBeTruthy();
  expect(button('删除')).toBeTruthy();
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
  const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  API.get.mockImplementation(url => {
    if (String(url).endsWith('/file')) {
      return Promise.resolve({ data: pdfBlob, headers: { 'content-type': 'application/pdf' } });
    }
    if (String(url).endsWith('/chunk-viewer')) {
      return Promise.resolve({ data: { success: true, data: { url: 'http://ac.zjugis.com:9381/chunk/parsed/chunks?id=ds-1&doc_id=doc1' } } });
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
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc1/chunk-viewer');
  expect(openSpy).toHaveBeenCalledWith(
    'http://ac.zjugis.com:9381/chunk/parsed/chunks?id=ds-1&doc_id=doc1',
    '_blank',
    'noopener,noreferrer',
  );
  openSpy.mockRestore();
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
    expect(container.textContent).toContain('可一次选择多个文件，每个不超过 20MB');
    const input = container.querySelector('input[type="file"]');
    expect(input.multiple).toBe(true);
    expect(input.hidden).toBe(false);
    expect(getComputedStyle(input).display).not.toBe('none');
    const upload = [...container.querySelectorAll('button')].find(item => item.textContent.includes('上传文件'));
    const clicked = jest.spyOn(input, 'click').mockImplementation(() => {});
    await act(async () => { upload.click(); });
    expect(clicked).toHaveBeenCalled();
    clicked.mockRestore();
    const file = new File(['hello'], '说明.txt', { type: 'text/plain' });
    const second = new File(['world'], '附录.md', { type: 'text/markdown' });
    API.post.mockClear();
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file, second] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
    const documentPosts = API.post.mock.calls.filter(call => call[0] === '/api/knowledge-admin/bases/1/documents');
    expect(documentPosts).toHaveLength(2);
    expect(documentPosts.map(call => call[1].get('file').name)).toEqual(['说明.txt', '附录.md']);

    const oversized = new File(['x'], 'big.bin');
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    API.post.mockClear();
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file, oversized] });
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
  expect(container.querySelector('.knowledge-review-count')?.textContent).toBe('1');
  await act(async () => { button('订阅审核').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('订阅审核');
  expect(container.textContent).toContain('alice');
  expect(container.textContent).toContain('地方法规知识库');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/subscription-applications?page=1&page_size=1&status=pending'));
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
  expect(container.querySelector('[aria-label="授权访问"]').checked).toBe(true);
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

test('edits and deletes a category from the hidden tab menu', async () => {
  const stored = [{ id: 1, name: '测绘规范', type: 'common', require_auth: false }];
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored } });
    return Promise.resolve(documentsResponse(url));
  });
  API.put.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories/1') {
      stored[0] = { ...stored[0], name: body.name, type: body.type, require_auth: body.require_auth };
      return Promise.resolve({ data: { success: true, data: stored[0] } });
    }
    return Promise.resolve({ data: { success: true, data: {} } });
  });
  API.delete.mockImplementation(url => {
    if (url === '/api/knowledge-admin/categories/1') {
      stored.splice(0, 1);
      return Promise.resolve({ data: { success: true } });
    }
    return Promise.resolve({ data: { success: true } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(document.querySelector('.knowledge-tab-menu-panel')).toBeNull();
  await act(async () => { container.querySelector('[aria-label="更多操作 测绘规范"]').click(); });
  expect(document.querySelector('.knowledge-tab-menu-panel')).toBeTruthy();
  await act(async () => {
    [...document.querySelectorAll('.knowledge-tab-menu-panel [role="menuitem"]')]
      .find(item => item.textContent.includes('编辑')).click();
  });
  expect(container.textContent).toContain('编辑知识库分类');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const name = container.querySelector('input[placeholder="请输入分类名称"]');
  await act(async () => {
    setValue.call(name, '规范汇编');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.put).toHaveBeenCalledWith('/api/knowledge-admin/categories/1', { name: '规范汇编', type: 'common', require_auth: false });
  expect(button('规范汇编')).toBeTruthy();

  await act(async () => { container.querySelector('[aria-label="更多操作 规范汇编"]').click(); });
  await act(async () => {
    [...document.querySelectorAll('.knowledge-tab-menu-panel [role="menuitem"]')]
      .find(item => item.textContent.includes('删除')).click();
  });
  expect(container.textContent).toContain('确认删除「规范汇编」？分类下知识库也会同步删除。');
  await act(async () => {
    [...container.querySelectorAll('.knowledge-modal footer button')].find(item => item.textContent === '删除').click();
  });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.delete).toHaveBeenCalledWith('/api/knowledge-admin/categories/1');
  expect(container.querySelector('[aria-label="更多操作 规范汇编"]')).toBeNull();
  expect(button('个人知识库').getAttribute('aria-selected')).toBe('true');
});

test('public category can still require authorization', async () => {
  const stored = [];
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored } });
    return Promise.resolve(documentsResponse(url));
  });
  API.post.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories') {
      const row = { id: 8, name: body.name, type: body.type, require_auth: body.require_auth };
      stored.push(row);
      return Promise.resolve({ data: { success: true, data: row } });
    }
    return Promise.resolve({ data: { success: true, data: { id: 9 } } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  act(() => { button('新建知识库分类').click(); });
  expect(container.querySelector('[aria-label="授权访问"]').checked).toBe(false);
  act(() => { container.querySelector('[aria-label="分类类型"]').click(); });
  act(() => { document.querySelector('[role="option"][value="public"]').click(); });
  const authSwitch = container.querySelector('[aria-label="授权访问"]');
  expect(authSwitch.checked).toBe(false);
  act(() => { authSwitch.click(); });
  expect(container.querySelector('[aria-label="授权访问"]').checked).toBe(true);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const name = container.querySelector('input[placeholder="请输入分类名称"]');
  act(() => {
    setValue.call(name, '公开规范');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/categories', { name: '公开规范', type: 'common', require_auth: true });
});

test('personal knowledge lists real users, filters a department, then opens that person’s files', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/user/?p=0&size=100');
  expect(container.querySelector('[aria-pressed="true"]').textContent).toContain('全部人员');
  expect(container.textContent).toContain('爱丽丝');
  expect(container.textContent).toContain('陈静');
  expect(container.textContent).toContain('未分配部门');
  const office = [...container.querySelectorAll('.knowledge-directory-nav button')].find(item => item.textContent.includes('办公室'));
  await act(async () => { office.click(); });
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('办公室');
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('1人');
  expect(container.querySelector('.knowledge-person-files')).toBeNull();
  expect(container.textContent).toContain('陈静');
  expect(container.textContent).not.toContain('爱丽丝');
  await act(async () => { button('全部人员').click(); });
  await act(async () => { button('爱丽丝').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('爱丽丝 的文件清单');
  expect(container.textContent).toContain('个人笔记');
  expect(container.textContent).toContain('测绘标准规范合集_文件1.pdf');
  expect(container.textContent).toContain('1个知识库');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/bases/2/documents?page=1&page_size=100'));
  const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  API.get.mockImplementation(url => {
    if (String(url).endsWith('/file')) return Promise.resolve({ data: pdfBlob, headers: { 'content-type': 'application/pdf' } });
    if (String(url).endsWith('/chunk-viewer')) {
      return Promise.resolve({ data: { success: true, data: { url: 'http://ac.zjugis.com:9381/chunk/parsed/chunks?id=ds-2&doc_id=doc1' } } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { button('预览').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/2/documents/doc1/file', { responseType: 'blob' });
  expect(container.querySelector('.knowledge-viewer iframe')).toBeTruthy();
  await act(async () => { button('切片').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/2/documents/doc1/chunk-viewer');
  expect(openSpy).toHaveBeenCalledWith(
    'http://ac.zjugis.com:9381/chunk/parsed/chunks?id=ds-2&doc_id=doc1',
    '_blank',
    'noopener,noreferrer',
  );
  openSpy.mockRestore();
});

test('toggles personal libraries from the person file-list title and deletes via menu', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('爱丽丝').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('爱丽丝 的文件清单');
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeNull();
  await act(async () => { container.querySelector('.knowledge-person-file-title').click(); });
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeTruthy();
  expect(container.textContent).toContain('个人笔记');
  expect(container.querySelector('[aria-label="个人知识库"] .knowledge-card-menu-panel')).toBeNull();
  await act(async () => { container.querySelector('[aria-label="更多操作 个人笔记"]').click(); });
  expect(container.querySelector('[aria-label="个人知识库"] .knowledge-card-menu-panel')).toBeTruthy();
  await act(async () => {
    [...container.querySelectorAll('[aria-label="个人知识库"] [role="menuitem"]')]
      .find(item => item.textContent.includes('删除')).click();
  });
  expect(container.textContent).toContain('确认删除个人知识库「个人笔记」');
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/bases') {
      return Promise.resolve({ data: { success: true, data: libraries.filter(item => item.id !== 2) } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => {
    [...container.querySelectorAll('.knowledge-modal footer button')].find(item => item.textContent === '删除').click();
  });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.delete).toHaveBeenCalledWith('/api/knowledge-admin/bases/2');
  expect(container.querySelector('[aria-label="更多操作 个人笔记"]')).toBeNull();
  await act(async () => { container.querySelector('.knowledge-person-file-title').click(); });
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeNull();
});

test('personal knowledge stays on all people when users have no department', async () => {
  API.get.mockImplementation(url => {
    if (String(url).startsWith('/api/user/')) {
      return Promise.resolve({ data: { success: true, data: [{ id: 2, username: 'alice', display_name: '爱丽丝', department_name: '', created_at: '2024-01-02T00:00:00Z', status: 1 }] } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('当前没有部门数据，先按全部人员查看。');
  expect(container.textContent).toContain('爱丽丝');
  expect(button('办公室')).toBeUndefined();
});
