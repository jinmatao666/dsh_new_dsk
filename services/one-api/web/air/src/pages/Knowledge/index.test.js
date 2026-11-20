/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import KnowledgeLibrary from './index';
import ActivityLog from './ActivityLog';
import { API, isAdmin, isRoot } from '../../helpers';

jest.mock('../../helpers', () => ({
  API: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  isAdmin: jest.fn(() => true),
  isRoot: jest.fn(() => true),
}));

const categories = [
  { id: 1, name: '测绘规范', type: 'common', require_auth: false },
];
const libraries = [
  { id: 1, name: '测绘标准规范合集', description: '关于测绘标准规范合集的详细知识资源集合', kind: 'common', category_id: 1, shelf: 'published', tags: '政策法规,林草资源', owner_user_id: 1, owner_username: 'root', visit_count: 12, daily_usage: 3, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
  { id: 2, name: '个人笔记', description: '个人资料', kind: 'personal', shelf: 'published', tags: '', owner_username: 'alice', owner_user_id: 2, visit_count: 0, daily_usage: 0, updated_at: '2024-01-02T00:00:00Z', created_at: '2024-01-02T00:00:00Z' }
];
const documents = [
  { id: 'doc1', name: '测绘标准规范合集_文件1.pdf', size: 11.3 * 1024 * 1024, create_time: 1748833920, chunk_count: 7, summary: '这是测绘标准规范合集文件1的文档摘要' }
];
const documentPage = { items: documents, total: 1, page: 1, page_size: 20 };
const users = [
  { id: 1, username: 'root', display_name: '管理员', department_name: '', created_at: '2024-01-01T00:00:00Z', status: 1 },
  { id: 2, username: 'alice', display_name: '爱丽丝', department_name: '', created_at: '2024-01-02T00:00:00Z', status: 1 },
  { id: 8, username: 'chen', display_name: '陈静', department_name: '办公室', created_at: '2019-05-20T00:00:00Z', status: 1 },
];
const orgNodes = [
  { id: 1, name: '浙江万维空间信息技术有限公司', parent_id: 0, kind: '公司', sort_order: 0 },
  { id: 2, name: '办公室', parent_id: 1, kind: '', sort_order: 0 },
];
const orgMemberships = {
  users: [
    { id: 2, username: 'alice', display_name: '爱丽丝' },
    { id: 8, username: 'chen', display_name: '陈静' },
  ],
  memberships: [{ user_id: 8, node_id: 2 }],
};

function documentsResponse(url) {
  const path = String(url);
  if (path.startsWith('/api/user/')) return { data: { success: true, data: users } };
  if (path === '/api/government-organization/') return { data: { success: true, data: orgNodes } };
  if (path === '/api/government-organization/memberships') {
    return { data: { success: true, data: orgMemberships } };
  }
  if (path === '/api/knowledge-bases/organization-directory') {
    return {
      data: {
        success: true,
        data: {
          nodes: orgNodes,
          users: orgMemberships.users,
          memberships: orgMemberships.memberships,
        },
      },
    };
  }
  if (path === '/api/knowledge-admin/categories' || path === '/api/knowledge-bases/categories') {
    return { data: { success: true, data: categories } };
  }
  if (path === '/api/knowledge-admin/bases' || path === '/api/knowledge-bases') {
    return { data: { success: true, data: libraries } };
  }
  if (path === '/api/knowledge-admin/ragflow-datasets' || path === '/api/knowledge-bases/ragflow-datasets') {
    return { data: { success: true, data: [{ id: 'ds-remote-1', name: '平台规范库' }, { id: 'ds-remote-2', name: '已解析资料' }] } };
  }
  if (path.startsWith('/api/knowledge-admin/publication-applications') || path.startsWith('/api/knowledge-admin/subscription-applications')) {
    return { data: { success: true, data: { items: [], total: 0, page: 1, page_size: 1 } } };
  }
  if (path.includes('/documents?') || /\/documents$/.test(path)) {
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
  isAdmin.mockReturnValue(true);
  isRoot.mockReturnValue(true);
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 100, username: 'root' }));
  API.get.mockImplementation(url => Promise.resolve(documentsResponse(url)));
  API.post.mockResolvedValue({ data: { success: true, data: { id: 9 } } });
  API.put.mockResolvedValue({ data: { success: true, data: {} } });
  API.delete.mockResolvedValue({ data: { success: true, message: '已删除' } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
  localStorage.removeItem('user');
  delete global.IS_REACT_ACT_ENVIRONMENT;
});

function button(text) {
  const items = [...container.querySelectorAll('button')];
  return items.find(item => item.textContent.trim() === text)
    || items.find(item => item.textContent.includes(text));
}

test('public files show uploaders and return only to a selected uploader library', async () => {
  API.get.mockImplementation(url => {
    if (String(url).endsWith('/return-targets')) return Promise.resolve({ data: { success: true, data: [{ id: 7, name: '上传人的个人资料' }] } });
    if (String(url).includes('/bases/1/documents?')) return Promise.resolve({ data: { success: true, data: { ...documentPage, total: 3, items: [
      { ...documents[0], creator_name: '小李', uploader_user_id: 2 },
      { ...documents[0], id: 'unknown', name: '历史文件.pdf' },
      { ...documents[0], id: 'zero-uploader', name: '未记录上传人.pdf', uploader_user_id: 0 },
    ] } } });
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('测绘规范').click(); });
  await act(async () => { button('文件清单').click(); });
  expect(container.textContent).toContain('上传人');
  expect(container.textContent).toContain('小李');
  expect([...container.querySelectorAll('.knowledge-ops button')].filter(item => item.textContent === '转回个人库')).toHaveLength(1);
  expect(button('日志').parentElement.lastElementChild).toBe(button('日志'));
  expect(button('日志').classList.contains('knowledge-inbox-entry')).toBe(false);
  await act(async () => { button('转回个人库').click(); });
  const dialog = container.querySelector('[aria-label="转回上传人个人库"]');
  expect(dialog.textContent).toContain('小李');
  expect(dialog.querySelector('select').value).toBe('7');
  await act(async () => { dialog.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc1/return-personal', { target_knowledge_base_id: 7 });
  expect(container.querySelector('[aria-label="转回上传人个人库"]')).toBeNull();
});

test.each([404, 504])('return target failure %s exits loading and leaves the dialog cancellable', async status => {
  API.get.mockImplementation(url => {
    if (String(url).endsWith('/return-targets')) {
      return Promise.reject({ response: { status }, message: status === 404 ? 'Request failed with status code 404' : 'timeout of 15000ms exceeded' });
    }
    if (String(url).includes('/bases/1/documents?')) return Promise.resolve({ data: { success: true, data: {
      ...documentPage, items: [{ ...documents[0], creator_name: '小李', uploader_user_id: 2 }],
    } } });
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('测绘规范').click(); });
  await act(async () => { button('文件清单').click(); });
  await act(async () => { button('转回个人库').click(); });
  const dialog = container.querySelector('[aria-label="转回上传人个人库"]');
  expect(dialog.querySelector('[role="status"]')).toBeNull();
  expect(dialog.querySelector('[role="alert"]').textContent).toBe(status === 404
    ? '知识库接口不存在，请更新并重启 OneAPI 服务' : 'timeout of 15000ms exceeded');
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/bases/1/documents/doc1/return-targets', { timeout: 15000 });
  expect([...dialog.querySelectorAll('button')].find(item => item.textContent === '确认转回').disabled).toBe(true);
  await act(async () => { [...dialog.querySelectorAll('button')].find(item => item.textContent === '取消').click(); });
  expect(container.querySelector('[aria-label="转回上传人个人库"]')).toBeNull();
});

test('category cards pair design-name marks with hue-matched banner plates', async () => {
  const themed = [
    { id: 11, name: '占卜平衡专题', description: '', kind: 'shared', category_id: 1, shelf: 'published', tags: '专题', owner_user_id: 1, owner_username: 'root', visit_count: 0, daily_usage: 0, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
    { id: 12, name: '土地征收指引', description: '', kind: 'shared', category_id: 1, shelf: 'published', tags: '专题', owner_user_id: 1, owner_username: 'root', visit_count: 0, daily_usage: 0, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
    { id: 13, name: '耕地保护手册', description: '', kind: 'shared', category_id: 1, shelf: 'published', tags: '专题', owner_user_id: 1, owner_username: 'root', visit_count: 0, daily_usage: 0, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
    { id: 14, name: '闲置土地台账', description: '', kind: 'shared', category_id: 1, shelf: 'published', tags: '专题', owner_user_id: 1, owner_username: 'root', visit_count: 0, daily_usage: 0, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00' },
    {
      id: 15, name: '生态修复', description: '', kind: 'shared', category_id: 1, shelf: 'published', tags: '专题',
      cover: 'data:image/png;base64,aaaa', owner_user_id: 1, owner_username: 'root',
      visit_count: 0, daily_usage: 0, updated_at: '2025-08-10T15:52:00+08:00', created_at: '2025-08-10T15:52:00+08:00',
    },
  ];
  API.get.mockImplementation(url => {
    const path = String(url);
    if (path === '/api/knowledge-admin/bases' || path === '/api/knowledge-bases') {
      return Promise.resolve({ data: { success: true, data: themed } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('测绘规范').click(); });
  const cards = [...container.querySelectorAll('.knowledge-card')];
  expect(cards).toHaveLength(5);
  const byName = name => cards.find(card => card.querySelector('h2')?.textContent === name);
  expect(byName('占卜平衡专题').querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-theme-grid.png');
  expect(byName('占卜平衡专题').querySelector('.knowledge-card-banner img')?.getAttribute('src')).toContain('card-banner-mint.png');
  expect(byName('土地征收指引').querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-theme-zheng.png');
  expect(byName('土地征收指引').querySelector('.knowledge-card-banner img')?.getAttribute('src')).toContain('card-banner-pink.png');
  expect(byName('耕地保护手册').querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-theme-seedling.png');
  expect(byName('耕地保护手册').querySelector('.knowledge-card-banner img')?.getAttribute('src')).toContain('card-banner.png');
  expect(byName('闲置土地台账').querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-theme-clock.png');
  expect(byName('闲置土地台账').querySelector('.knowledge-card-banner img')?.getAttribute('src')).toContain('card-banner.png');
  // Unmatched names keep the blue-book default even when a cover is stored.
  expect(byName('生态修复').querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-library-default.png');
  expect(byName('生态修复').querySelector('.knowledge-card-mark.has-cover')).toBeNull();
  expect(byName('生态修复').querySelector('header .knowledge-card-menu')).toBeTruthy();
});

test('sort listbox preserves the selected value and creates a personal library', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('组织架构');
  expect(container.textContent).not.toContain('全部人员');
  expect(container.querySelector('select')).toBeNull();
  await act(async () => { button('测绘规范').click(); });
  const sort = container.querySelector('[aria-label="排序"]');
  act(() => { sort.click(); });
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  act(() => { document.querySelector('[role="option"][value="asc"]').click(); });
  expect(sort.textContent).toContain('按时间升序');
  await act(async () => { button('个人知识库').click(); });
  act(() => { button('新建知识库').click(); });
  expect(container.querySelector('.knowledge-modal h2')?.textContent).toBe('新建知识库');
  expect(container.querySelector('[aria-label="知识库类型"]')).toBeNull();
  const name = container.querySelector('input[placeholder="请输入知识库名称"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, '个人测试');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({ kind: 'personal', name: '个人测试' }));
  expect(API.post.mock.calls[0][1]).not.toHaveProperty('owner_user_id');
});

test.each([true, false])('only administrators can create for a person with no personal libraries: admin %s', async administrator => {
  isAdmin.mockReturnValue(administrator);
  isRoot.mockReturnValue(administrator);
  if (!administrator) localStorage.setItem('user', JSON.stringify({ id: 8, role: 1, username: 'chen' }));
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('陈静').click(); });
  const files = container.querySelector('[aria-label="个人文件清单"]');
  expect(files.textContent).toContain('0个知识库');
  const create = [...files.querySelectorAll('button')].find(item => item.textContent === '新建知识库');
  expect(Boolean(create)).toBe(administrator);
  if (!administrator) return;
  API.post.mockResolvedValueOnce({ data: { success: true, data: { id: 9, owner_user_id: 8, kind: 'personal', category_id: 0 } } });
  await act(async () => { create.click(); });
  expect(container.querySelector('.knowledge-modal').textContent).toContain('为 陈静 创建个人知识库');
  await act(async () => {
    Simulate.change(container.querySelector('input[placeholder="请输入知识库名称"]'), { target: { value: '陈静的资料' } });
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({ name: '陈静的资料', kind: 'personal', owner_user_id: 8 }));
  await act(async () => { container.querySelector('[aria-label="文件清单"] .knowledge-back').click(); });
  expect(container.querySelector('[aria-label="个人文件清单"]').textContent).toContain('1个知识库');
  expect([...container.querySelectorAll('[aria-label="个人文件清单"] button')].some(item => item.textContent === '新建知识库')).toBe(false);
  await act(async () => { container.querySelector('[aria-label="个人文件清单"] .knowledge-back').click(); });
  const chen = [...container.querySelectorAll('.knowledge-person')].find(item => item.textContent.includes('陈静'));
  expect(chen.querySelector('.knowledge-person-stats').textContent).toMatch(/1\s*知识库/);
});

test('creation for a person reports an owner mismatch without treating it as success', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('陈静').click(); });
  await act(async () => { button('新建知识库').click(); });
  await act(async () => {
    Simulate.change(container.querySelector('input[placeholder="请输入知识库名称"]'), { target: { value: '陈静的资料' } });
  });
  API.post.mockResolvedValueOnce({ data: { success: true, data: { id: 9, owner_user_id: 1 } } });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('.knowledge-modal [role="alert"]').textContent).toContain('归属与所选人员不一致');
  expect(container.querySelector('[aria-label="文件清单"]')).toBeNull();
});

test('knowledge catalog filters scopes and opens the file list', async () => {
  // Strict Mode re-runs effects once; stats must still resolve (not stick on "…").
  await act(async () => { root.render(<React.StrictMode><KnowledgeLibrary /></React.StrictMode>); });
  for (let i = 0; i < 12; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('组织架构');
  expect(container.textContent).not.toContain('全部人员');
  expect(container.textContent).not.toContain('请从左侧选择组织节点');
  expect(container.querySelector('.knowledge-people-head h2')?.textContent).toContain('浙江万维空间信息技术有限公司');
  expect(container.textContent).not.toContain('个人笔记');
  expect(container.textContent).not.toContain('已上架');
  expect(container.textContent).not.toContain('下架');
  expect(button('个人知识库').textContent).toContain('1');
  expect(button('测绘规范').textContent).toContain('1');
  expect(button('共性知识库')).toBeUndefined();
  expect(button('共享知识库')).toBeUndefined();
  expect(container.querySelector('.knowledge-page-header-art')?.getAttribute('src')).toContain('page-header-art.png');
  const hero = container.querySelector('.knowledge-hero');
  expect(hero).toBeTruthy();
  expect(hero.contains(container.querySelector('.knowledge-page-header-art'))).toBe(true);
  expect(hero.contains(container.querySelector('.knowledge-chrome'))).toBe(true);
  expect(hero.contains(button('待办箱'))).toBe(true);
  expect(hero.contains(button('新建知识库分类'))).toBe(true);
  await act(async () => { button('测绘规范').click(); });
  expect(container.textContent).toContain('测绘标准规范合集');
  expect(container.textContent).not.toContain('个人笔记');
  expect(container.textContent).toContain('创建人');
  expect(container.textContent).toContain('管理员');
  expect(container.querySelector('.knowledge-meta')?.textContent).not.toContain('#1');
  expect(container.querySelector('.knowledge-meta')?.textContent).not.toMatch(/\broot\b/);
  expect(container.textContent).toContain('文件量');
  expect(container.textContent).toContain('1个');
  expect(container.textContent).toContain('大小');
  expect(container.textContent).toContain('11.3MB');
  expect(container.textContent).toContain('用户访问量');
  expect(container.textContent).toContain('12');
  expect(container.textContent).toContain('每天使用量');
  expect(container.textContent).toContain('3');
  const card = container.querySelector('.knowledge-card');
  expect(card.querySelector('.knowledge-card-banner img')?.getAttribute('src')).toContain('card-banner.png');
  expect(card.querySelector('.knowledge-card-mark img')?.getAttribute('src')).toContain('icon-library-default.png');
  expect(card.querySelector('.knowledge-card-more-art')?.getAttribute('src')).toContain('icon-card-more.png');
  expect(card.querySelector('.knowledge-card-titles p')?.textContent).toBe('关于测绘标准规范合集的详细知识资源集…');
  expect(card.querySelector('.knowledge-card-file-list-art')?.getAttribute('src')).toContain('icon-file-list.png');
  expect(container.querySelector('.knowledge-toolbar')).toBeTruthy();
  expect(container.querySelector('.knowledge-page-header-art')?.getAttribute('src')).toContain('page-header-art.png');
  const meta = container.querySelector('.knowledge-meta');
  expect(meta.querySelector('.knowledge-meta-label').textContent).toBe('创建人');
  expect(meta.querySelector('.knowledge-meta-value').textContent).toBe('管理员');
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
    cover: '',
  }));
  await act(async () => { button('文件清单').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('测绘标准规范合集-文件清单');
  expect(container.textContent).toContain('测绘标准规范合集_文件1.pdf');
  expect(container.textContent).toContain('7');
  expect(container.textContent).toContain('这是测绘标准规范合集文件1的文档摘要');
  expect(container.textContent).toContain('共 1 条，每页20条');
  expect(container.textContent).toContain('第 1 页 / 1');
  expect(container.textContent).toContain('跳至');
  expect(button('浏览')?.querySelector('img')?.getAttribute('src')).toContain('icon-file-browse.png');
  expect(button('下载')?.querySelector('img')?.getAttribute('src')).toContain('icon-file-download.png');
  expect(button('切片')?.querySelector('img')?.getAttribute('src')).toContain('icon-file-chunks.png');
  expect(button('摘要')?.querySelector('img')?.getAttribute('src')).toContain('icon-file-summary.png');
  expect(button('删除')?.querySelector('img')?.getAttribute('src')).toContain('icon-file-delete.png');
  expect([...container.querySelectorAll('button')].find(item => item.textContent.includes('上传文件'))
    ?.querySelector('img')?.getAttribute('src')).toContain('icon-file-upload.png');
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
    expect(container.textContent).not.toContain('可一次选择多个文件，每个不超过 20MB');
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
    expect(container.textContent).toContain('协作资料-文件清单');
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
              applicant_user_id: 2,
              status: 'pending',
              knowledge_base_name: '地方法规知识库',
              category_name: '法律',
              applicant_username: 'alice',
              owner_username: '鲍勃',
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
  await act(async () => { button('待办箱').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('订阅审核');
  expect(container.textContent).toContain('爱丽丝');
  expect(container.textContent).not.toContain('#2');
  expect(container.querySelector('.knowledge-table-wrap')?.textContent).not.toMatch(/\balice\b/);
  expect(container.textContent).toContain('地方法规知识库');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/subscription-applications?page=1&page_size=1&status=pending'));
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-admin/subscription-applications?page=1&page_size=20&status=pending'));
  await act(async () => { button('去审核').click(); });
  expect(container.textContent).toContain('同意');
  expect(container.textContent).toContain('不同意');
  await act(async () => { button('同意').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/subscription-applications/11/review', { decision: 'approve' });
});

test('creates a category beside personal and files the next library under it', async () => {
  const stored = [];
  API.get.mockImplementation(url => {
    // Copy so React state updates are not skipped on the same array reference.
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored.map(row => ({ ...row })) } });
    return Promise.resolve(documentsResponse(url));
  });
  API.post.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories') {
      const row = { id: 4, name: body.name, type: body.type, require_auth: body.require_auth };
      stored.push(row);
      return Promise.resolve({ data: { success: true, data: { ...row } } });
    }
    return Promise.resolve({ data: { success: true, data: { id: 9, name: body.name, kind: body.kind, category_id: body.category_id } } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  act(() => { button('新建知识库分类').click(); });
  act(() => { container.querySelector('[aria-label="分类类型"]').click(); });
  act(() => { document.querySelector('[role="option"][value="authorized"]').click(); });
  expect(container.textContent).toContain('授权：订阅审核通过后，申请人可见');
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
  expect(container.querySelector('.knowledge-modal h2')?.textContent).toBe('新建知识库');
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
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored.map(row => ({ ...row })) } });
    return Promise.resolve(documentsResponse(url));
  });
  API.put.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories/1') {
      stored[0] = { ...stored[0], name: body.name, type: body.type, require_auth: body.require_auth };
      return Promise.resolve({ data: { success: true, data: { ...stored[0] } } });
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

test('personal category defaults to self-only require_auth', async () => {
  const stored = [];
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/categories') return Promise.resolve({ data: { success: true, data: stored.map(row => ({ ...row })) } });
    return Promise.resolve(documentsResponse(url));
  });
  API.post.mockImplementation((url, body) => {
    if (url === '/api/knowledge-admin/categories') {
      const row = { id: 8, name: body.name, type: body.type, require_auth: body.require_auth };
      stored.push(row);
      return Promise.resolve({ data: { success: true, data: { ...row } } });
    }
    return Promise.resolve({ data: { success: true, data: { id: 9 } } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  act(() => { button('新建知识库分类').click(); });
  expect(container.textContent).toContain('个人：仅创建者可见，其他人看不到该分类下知识库');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const name = container.querySelector('input[placeholder="请输入分类名称"]');
  act(() => {
    setValue.call(name, '随便建的');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/categories', { name: '随便建的', type: 'personal', require_auth: true });
});

test('personal knowledge browses by organization tree without listing all people', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/user/?p=0&size=100');
  expect(API.get).toHaveBeenCalledWith('/api/government-organization/');
  expect(API.get).toHaveBeenCalledWith('/api/government-organization/memberships');
  expect(container.textContent).toContain('浙江万维空间信息技术有限公司');
  expect(container.textContent).toContain('办公室');
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('浙江万维空间信息技术有限公司');
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('浙江万维空间信息技术有限公司');
  expect(container.textContent).not.toContain('全部人员');
  expect(container.textContent).toContain('陈静');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('爱丽丝');
  // Personal-tab chrome uses staged js.design cutouts (transparent PNG).
  expect(button('待办箱')?.querySelector('svg')).toBeTruthy();
  expect(button('个人知识库')?.querySelector('.knowledge-tab-icon')).toBeNull();
  expect(container.querySelector('.knowledge-org-node-icon')?.getAttribute('src')).toContain('icon-org-node.png');
  expect(button('新建知识库分类')?.querySelector('img')?.getAttribute('src')).toContain('icon-new-category.png');
  expect(button('新建知识库')?.querySelector('img')?.getAttribute('src')).toContain('icon-new-library.png');
  const office = [...container.querySelectorAll('.knowledge-org-label')].find(item => item.textContent.includes('办公室'));
  await act(async () => { office.click(); });
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('办公室');
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('1人');
  expect(container.querySelector('.knowledge-person-files')).toBeNull();
  expect(container.textContent).toContain('陈静');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('爱丽丝');
  // Person card: solid avatar, stacked 组织/注册 labels, stats with count above label.
  const chen = [...container.querySelectorAll('.knowledge-person')].find(item => item.textContent.includes('陈静'));
  expect(chen).toBeTruthy();
  expect(chen.querySelector('.knowledge-avatar')?.textContent).toBe('陈');
  expect(chen.querySelector('.knowledge-avatar')?.getAttribute('style')).toMatch(/background:\s*rgb|#/);
  expect(chen.querySelector('.knowledge-person-meta-label')?.textContent).toBe('组织');
  expect(chen.querySelector('.knowledge-person-org')?.textContent).toContain('浙江万维空间信息技术有限公司');
  expect(chen.querySelector('.knowledge-person-org')?.textContent).toContain('/办公室');
  expect(chen.querySelector('.knowledge-person-registered')?.textContent).toBe('2019-05-20');
  expect(chen.querySelector('.knowledge-person-stats')?.textContent).toMatch(/0\s*知识库/);
  expect(chen.querySelector('.knowledge-person-stats')?.textContent).toMatch(/0B\s*总大小/);
  await act(async () => { button('未分配组织').click(); });
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('未分配组织');
  expect(container.textContent).toContain('爱丽丝');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('陈静');
  await act(async () => { button('爱丽丝').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('爱丽丝 的文件清单');
  expect(container.textContent).toContain('个人笔记');
  expect(container.textContent).toContain('测绘标准规范合集_文件1.pdf');
  expect(container.textContent).toContain('1个知识库');
  expect([...container.querySelectorAll('[aria-label="个人文件清单"] button')].some(item => item.textContent === '新建知识库')).toBe(false);
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
  await act(async () => { button('未分配组织').click(); });
  await act(async () => { button('爱丽丝').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('爱丽丝 的文件清单');
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeNull();
  await act(async () => { container.querySelector('.knowledge-person-file-title').click(); });
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeTruthy();
  expect(container.textContent).toContain('个人笔记');
  const picker = container.querySelector('input[type="file"][aria-label="上传文件"]');
  const openPicker = jest.spyOn(picker, 'click').mockImplementation(() => {});
  await act(async () => { button('上传文件').click(); });
  expect(openPicker).toHaveBeenCalledTimes(1);
  openPicker.mockRestore();
  expect(container.textContent).toContain('爱丽丝 的文件清单');
  await act(async () => { button('个人笔记').click(); });
  expect(container.textContent).toContain('个人笔记-文件清单');
  expect(button('上传文件')).toBeTruthy();
  await act(async () => { button('返回').click(); });
  expect(container.textContent).toContain('爱丽丝 的文件清单');
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

test('edits a personal library from the person file-list menu and refreshes its displayed name', async () => {
  let updated = libraries;
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/bases') {
      return Promise.resolve({ data: { success: true, data: updated } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  API.put.mockImplementation((url, data) => {
    updated = libraries.map(library => library.id === 2 ? { ...library, ...data } : library);
    return Promise.resolve({ data: { success: true, data: updated.find(library => library.id === 2) } });
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('未分配组织').click(); });
  await act(async () => { button('爱丽丝').click(); });
  await act(async () => { container.querySelector('.knowledge-person-file-title').click(); });
  await act(async () => { container.querySelector('[aria-label="更多操作 个人笔记"]').click(); });
  await act(async () => {
    [...container.querySelectorAll('[aria-label="个人知识库"] [role="menuitem"]')]
      .find(item => item.textContent.includes('编辑')).click();
  });
  expect(container.querySelector('#dsh-knowledge-edit-title')?.textContent).toBe('编辑知识库');
  const editName = container.querySelector('.knowledge-modal input[maxlength="128"]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(editName, '个人笔记修订');
    editName.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('.knowledge-modal').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(API.put).toHaveBeenCalledWith('/api/knowledge-admin/bases/2', expect.objectContaining({ name: '个人笔记修订' }));
  expect(container.querySelector('.knowledge-modal')).toBeNull();
  expect(container.querySelector('.knowledge-person-library-copy strong')?.textContent).toBe('个人笔记修订');
  expect(container.querySelector('.knowledge-person-files tbody tr td:nth-child(2)')?.textContent).toBe('个人笔记修订');
  expect(container.textContent).toContain('爱丽丝 的文件清单');
});

test.each([
  [1, false, false],
  [10, true, true],
  [100, true, true],
])('category creation visibility follows administrator role %s', async (role, admin, visible) => {
  isAdmin.mockReturnValue(admin);
  isRoot.mockReturnValue(role >= 100);
  localStorage.setItem('user', JSON.stringify({ id: 2, role, username: 'alice' }));
  await act(async () => { root.render(<KnowledgeLibrary />); });
  expect(Boolean(button('新建知识库分类'))).toBe(visible);
});

test('personal knowledge prompts for organization setup when the tree is empty', async () => {
  API.get.mockImplementation(url => {
    if (String(url) === '/api/government-organization/') {
      return Promise.resolve({ data: { success: true, data: [] } });
    }
    if (String(url) === '/api/government-organization/memberships') {
      return Promise.resolve({ data: { success: true, data: { users: [], memberships: [] } } });
    }
    if (String(url).startsWith('/api/user/')) {
      return Promise.resolve({ data: { success: true, data: [{ id: 2, username: 'alice', display_name: '爱丽丝', department_name: '', created_at: '2024-01-02T00:00:00Z', status: 1 }] } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('暂无组织节点');
  expect(container.textContent).toContain('请先在用户权限');
  expect(container.textContent).not.toContain('全部人员');
  expect(container.querySelector('.knowledge-people-grid')).toBeNull();
  expect(button('办公室')).toBeUndefined();
});

test('create dialog can bind an existing RAGFlow dataset', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('个人知识库').click(); });
  act(() => { button('新建知识库').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-bases/ragflow-datasets');
  const modal = container.querySelector('.knowledge-modal');
  const source = modal.querySelector('[aria-label="创建方式"]');
  expect(source).not.toBeNull();
  await act(async () => {
    source.value = 'existing';
    source.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dataset = modal.querySelector('[aria-label="已有知识库"]');
  expect(dataset.textContent).toContain('平台规范库');
  await act(async () => {
    dataset.value = 'ds-remote-1';
    dataset.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(modal.querySelector('input[placeholder="请输入知识库名称"]').value).toBe('平台规范库');
  await act(async () => { modal.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({
    name: '平台规范库',
    kind: 'personal',
    ragflow_dataset_id: 'ds-remote-1',
  }));
});

test('create and edit send a cover image', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('个人知识库').click(); });
  act(() => { button('新建知识库').click(); });
  const modal = container.querySelector('.knowledge-modal');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const name = modal.querySelector('input[placeholder="请输入知识库名称"]');
  await act(async () => {
    setValue.call(name, '带封面');
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const file = new File(['png-bytes'], 'cover.png', { type: 'image/png' });
  const input = modal.querySelector('input[aria-label="上传封面"]');
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(modal.querySelector('img')?.getAttribute('src') || '').toMatch(/^data:image\/png;base64,/);
  await act(async () => { modal.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/bases', expect.objectContaining({
    name: '带封面',
    kind: 'personal',
    cover: expect.stringMatching(/^data:image\/png;base64,/),
  }));

  await act(async () => { button('返回').click(); });
  await act(async () => { button('测绘规范').click(); });
  await act(async () => { container.querySelector('[aria-label="更多操作"]').click(); });
  await act(async () => { button('编辑').click(); });
  const editModal = container.querySelector('.knowledge-modal');
  expect(editModal.textContent).toContain('未选择图片');
  const editInput = editModal.querySelector('input[aria-label="上传封面"]');
  const next = new File(['jpeg-bytes'], 'next.png', { type: 'image/png' });
  await act(async () => {
    Object.defineProperty(editInput, 'files', { configurable: true, value: [next] });
    editInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(button('移除封面')).toBeTruthy();
  await act(async () => { editModal.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.put).toHaveBeenCalledWith('/api/knowledge-admin/bases/1', expect.objectContaining({
    name: '测绘标准规范合集',
    cover: expect.stringMatching(/^data:image\/png;base64,/),
  }));
});

test('ordinary user personal tab uses scoped organization directory like root', async () => {
  isAdmin.mockReturnValue(false);
  isRoot.mockReturnValue(false);
  localStorage.setItem('user', JSON.stringify({ id: 8, role: 1, username: 'chen' }));
  API.get.mockImplementation(url => {
    if (String(url) === '/api/knowledge-bases/organization-directory') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            nodes: [
              { id: 1, name: '浙江万维空间信息技术有限公司', parent_id: 0, kind: '公司', sort_order: 0 },
              { id: 2, name: '办公室', parent_id: 1, kind: '', sort_order: 0 },
            ],
            users: [
              { id: 8, username: 'chen', display_name: '陈静' },
            ],
            memberships: [
              { user_id: 8, node_id: 2 },
            ],
          },
        },
      });
    }
    if (String(url) === '/api/knowledge-bases') {
      return Promise.resolve({
        data: {
          success: true,
          data: [
            {
              id: 2, name: '个人笔记', kind: 'personal', shelf: 'published',
              owner_user_id: 8, owner_username: 'chen',
              updated_at: '2024-01-02T00:00:00Z', created_at: '2024-01-02T00:00:00Z',
            },
            {
              id: 5, name: '同事资料', kind: 'personal', shelf: 'published',
              owner_user_id: 9, owner_username: 'jmt',
              updated_at: '2024-01-03T00:00:00Z', created_at: '2024-01-03T00:00:00Z',
            },
            {
              id: 6, name: '项目资料', kind: 'personal', shelf: 'published',
              owner_user_id: 8, owner_username: 'chen',
            },
          ],
        },
      });
    }
    if (String(url).startsWith('/api/knowledge-bases/6/documents?')) {
      return Promise.resolve({
        data: { success: true, data: {
          ...documentPage,
          items: [{ ...documents[0], id: 'failed-doc', run: 'FAIL' }],
        } },
      });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-bases');
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-bases/organization-directory');
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-admin/categories');
  expect(API.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/user\//));
  expect(API.get).not.toHaveBeenCalledWith('/api/government-organization/');
  expect(container.textContent).toContain('组织架构');
  expect(container.textContent).toContain('办公室');
  expect(container.textContent).not.toContain('全部人员');
  expect(container.textContent).not.toContain('个人笔记');
  await act(async () => { button('办公室').click(); });
  expect(container.textContent).toContain('陈静');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('chen');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('jmt');
  expect(container.querySelector('.knowledge-people-grid')?.textContent).not.toContain('爱丽丝');
  expect(container.querySelector('.knowledge-people-head h2').textContent).toContain('1人');
  await act(async () => { button('陈静').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('陈静 的知识库');
  expect(API.get).toHaveBeenCalledWith(expect.stringContaining('/api/knowledge-bases/2/documents?'));
  expect(container.querySelector('[aria-label="个人知识库"]')).toBeNull();
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(2);
  expect(container.querySelector('.knowledge-person-files')).toBeNull();
  expect(container.textContent).toContain('个人笔记');
  expect(container.textContent).not.toContain('同事资料');
  expect(container.querySelector('[aria-label="更多操作 个人笔记"]')).toBeNull();
  expect(button('待办箱')).toBeUndefined();
  const projectCard = [...container.querySelectorAll('.knowledge-card')]
    .find(card => card.querySelector('h2')?.textContent === '项目资料');
  await act(async () => {
    projectCard.querySelector('.knowledge-card-actions button').click();
  });
  expect(container.textContent).toContain('项目资料-文件清单');
  expect(button('上传文件').disabled).toBe(false);
  expect(container.textContent).toContain('解析失败');
  await act(async () => { button('重新解析').click(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-bases/6/documents/failed-doc/parse');
  const upload = container.querySelector('input[type="file"][aria-label="上传文件"]');
  const file = new File(['hello'], '项目说明.txt', { type: 'text/plain' });
  await act(async () => {
    Object.defineProperty(upload, 'files', { value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const posted = API.post.mock.calls.find(([url]) => url === '/api/knowledge-bases/6/documents');
  expect(posted?.[1].get('file').name).toBe('项目说明.txt');
  expect(container.textContent).toContain('项目资料-文件清单');
  await act(async () => { button('返回').click(); });
  expect(container.textContent).toContain('陈静 的知识库');
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(2);
  await act(async () => { button('返回').click(); });
  act(() => { button('新建知识库').click(); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  expect(API.get).toHaveBeenCalledWith('/api/knowledge-bases/ragflow-datasets');
  const modal = container.querySelector('.knowledge-modal');
  const source = modal.querySelector('[aria-label="创建方式"]');
  expect(source).not.toBeNull();
  await act(async () => {
    source.value = 'existing';
    source.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dataset = modal.querySelector('[aria-label="已有知识库"]');
  await act(async () => {
    dataset.value = 'ds-remote-1';
    dataset.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { modal.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await Promise.resolve(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-bases', expect.objectContaining({
    name: '平台规范库',
    kind: 'personal',
    ragflow_dataset_id: 'ds-remote-1',
  }));
});

test('opens multiple personal libraries as searchable cards and restores the catalog after viewing files', async () => {
  const personal = Array.from({ length: 15 }, (_, index) => ({
    ...libraries[1], id: 100 + index, name: `个人资料${String(index).padStart(2, '0')}`,
  }));
  API.get.mockImplementation(url => {
    if (url === '/api/knowledge-admin/bases') {
      return Promise.resolve({ data: { success: true, data: [libraries[0], ...personal] } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('未分配组织').click(); });
  await act(async () => { button('爱丽丝').click(); });
  expect(container.textContent).toContain('爱丽丝 的知识库');
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(12);
  expect(container.querySelector('.knowledge-person-files')).toBeNull();
  const pager = () => container.querySelector('[aria-label="个人知识库分页"]');
  expect(pager().textContent).toContain('共 15 个，每页 12 个');
  await act(async () => { [...pager().querySelectorAll('button')].find(item => item.textContent === '下一页').click(); });
  expect(pager().textContent).toContain('2 / 2');
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(3);
  const card = container.querySelector('.knowledge-person-catalog .knowledge-card');
  expect(card.querySelector('.knowledge-card-banner img')).toBeTruthy();
  expect(card.querySelector('.knowledge-meta').textContent).toContain('创建人爱丽丝');
  const selectedName = card.querySelector('h2').textContent;
  await act(async () => { card.querySelector('.knowledge-card-actions button').click(); });
  expect(container.textContent).toContain(`${selectedName}-文件清单`);
  expect(button('上传文件')).toBeTruthy();
  await act(async () => { button('返回').click(); });
  expect(pager().textContent).toContain('2 / 2');
  expect(container.querySelector('.knowledge-person-catalog h2').textContent).toBe('爱丽丝 的知识库');
  const search = container.querySelector('.knowledge-person-library-search input');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(search, '个人资料00');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(pager().textContent).toContain('1 / 1');
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(1);
  await act(async () => { container.querySelector('[aria-label="更多操作 个人资料00"]').click(); });
  await act(async () => { button('编辑').click(); });
  expect(container.querySelector('#dsh-knowledge-edit-title')?.textContent).toBe('编辑知识库');
  await act(async () => { button('取消').click(); });
  await act(async () => { container.querySelector('.knowledge-card-actions button').click(); });
  await act(async () => { button('返回').click(); });
  expect(container.querySelector('.knowledge-person-library-search input').value).toBe('个人资料00');
  expect(container.querySelectorAll('.knowledge-person-catalog .knowledge-card')).toHaveLength(1);
  await act(async () => { button('返回').click(); });
  expect(container.querySelector('.knowledge-people-grid')).toBeTruthy();
});

test('paginates category libraries and keeps the toolbar inside the sticky chrome', async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: index + 10,
    name: `授权库${String(index).padStart(2, '0')}`,
    description: '授权资料',
    kind: 'shared',
    category_id: 1,
    shelf: 'published',
    tags: '',
    owner_user_id: 1,
    owner_username: 'root',
    visit_count: 0,
    daily_usage: 0,
    updated_at: `2025-08-${String((index % 28) + 1).padStart(2, '0')}T12:00:00+08:00`,
    created_at: `2025-08-${String((index % 28) + 1).padStart(2, '0')}T12:00:00+08:00`,
  }));
  API.get.mockImplementation(url => {
    const path = String(url);
    if (path === '/api/knowledge-admin/bases' || path === '/api/knowledge-bases') {
      return Promise.resolve({ data: { success: true, data: [...libraries, ...many] } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('测绘规范').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  const sticky = container.querySelector('.knowledge-sticky');
  expect(sticky.querySelector('.knowledge-toolbar')).toBeTruthy();
  expect(sticky.querySelector('.knowledge-toolbar .knowledge-search')).toBeTruthy();
  expect(sticky.textContent).toContain('新建知识库');
  expect(container.querySelectorAll('.knowledge-card')).toHaveLength(12);
  expect(container.textContent).toContain('授权库27');
  expect(container.textContent).not.toContain('授权库00');
  const catalog = container.querySelector('.knowledge-library-catalog');
  const pager = container.querySelector('[aria-label="知识库分页"]');
  expect(catalog).toBeTruthy();
  expect(pager).toBeTruthy();
  expect(catalog.contains(container.querySelector('.knowledge-grid'))).toBe(true);
  expect(catalog.contains(pager)).toBe(true);
  expect(pager.textContent).toContain('共 31 个，每页 12 个');
  expect(pager.textContent).toContain('1 / 3');
  await act(async () => { button('下一页').click(); });
  expect(pager.textContent).toContain('2 / 3');
  expect(container.querySelectorAll('.knowledge-card').length).toBe(12);
});

test('keeps the category library pager when the filtered list fits on one page', async () => {
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  await act(async () => { button('测绘规范').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  const pager = container.querySelector('[aria-label="知识库分页"]');
  expect(pager).toBeTruthy();
  expect(pager.textContent).toContain('共 1 个，每页 12 个');
  expect(pager.textContent).toContain('1 / 1');
  expect(container.querySelectorAll('.knowledge-card').length).toBe(1);
});

test('highlights publication tasks in the inbox and requires a rejection reason', async () => {
  const application = { id: 31, knowledge_base_id: 4, knowledge_base_name: '个人资料发布', applicant_user_id: 2,
    applicant_username: '爱丽丝', category_name: '规范公开库', target: 'public', reason: '共享规范', status: 'pending' };
  API.get.mockImplementation(url => {
    if (String(url).startsWith('/api/knowledge-admin/publication-applications/31/documents?')) {
      return Promise.resolve({ data: { success: true, data: documentPage } });
    }
    if (String(url).startsWith('/api/knowledge-admin/publication-applications')) {
      return Promise.resolve({ data: { success: true, data: { items: [application], total: 1, page: 1, page_size: 20 } } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('.knowledge-inbox-banner')).toBeNull();
  expect(button('待办箱').textContent).toContain('1');
  await act(async () => { button('待办箱').click(); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('[role="tab"][aria-selected="true"]').textContent).toContain('发布审核');
  expect(container.textContent).toContain('公共知识库');
  expect(container.querySelector('.knowledge-inbox').textContent).toMatchSnapshot('publication inbox pending');
  await act(async () => { button('去审核').click(); });
  expect(container.querySelector('[role="dialog"][aria-label="发布审核"]').textContent).toMatchSnapshot('publication review dialog');
  expect(API.get.mock.calls.some(([url]) => String(url).startsWith('/api/knowledge-admin/publication-applications/31/documents'))).toBe(false);
  await act(async () => { button('全部文件').click(); });
  expect(API.get.mock.calls.some(([url]) => String(url).startsWith('/api/knowledge-admin/publication-applications/31/documents'))).toBe(true);
  expect(container.textContent).toContain(documents[0].name);
  await act(async () => { button('申请详情').click(); });

  expect(button('不同意').disabled).toBe(true);
  const note = container.querySelector('textarea[aria-label="审核意见"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, '请移除私人资料');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button('不同意').disabled).toBe(false);
  await act(async () => { button('不同意').click(); });
  expect(API.post).toHaveBeenCalledWith('/api/knowledge-admin/publication-applications/31/review', { decision: 'reject', note: '请移除私人资料' });
});


test('knowledge logs combine history, match reviewers to actions and search from the right toolbar', async () => {
  API.get.mockImplementation(url => {
    if (String(url).startsWith('/api/knowledge-admin/activities')) {
      const searching = String(url).includes('keyword=');
      const items = [
        { id: 1, knowledge_base_name: '个人笔记', action: 'publish_public', creator_id: 2, actor_id: 1, applicant_id: 2, status: 'approved', created_at: '2026-11-20T10:00:00+08:00' },
        { id: 2, knowledge_base_name: '目标资料', action: 'transfer', creator_id: 2, actor_id: 1, source_name: '公共资料', document_name: '规范.pdf', status: 'success', created_at: '2026-11-20T10:00:00+08:00' },
      ];
      return Promise.resolve({ data: { success: true, data: {
        items: searching ? [items[1]] : items, total: searching ? 1 : 2, names: { 1: '管理员', 2: '爱丽丝' },
      } } });
    }
    return Promise.resolve(documentsResponse(url));
  });
  await act(async () => { root.render(<KnowledgeLibrary />); });
  await act(async () => { button('日志').click(); });
  const log = container.querySelector('[aria-label="知识库日志"]');
  expect(log.textContent).toContain('爱丽丝');
  expect(log.textContent).toContain('管理员');
  expect(log.textContent).toContain('转公共');
  expect(log.querySelector('[role="tablist"]')).toBeNull();
  expect(log.querySelector('.knowledge-activity-operation').textContent).toBe('转公共审核人管理员');
  expect(log.querySelector('.knowledge-activity-people').textContent).toBe('创建人爱丽丝申请人爱丽丝');
  expect(log.textContent).toContain('公共资料');
  expect(log.textContent).toContain('规范.pdf');
  expect(log.textContent).toMatchSnapshot('combined activity history');
  const search = log.querySelector('.knowledge-activity-search input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, '规范');
    Simulate.change(search);
  });
  await act(async () => { log.querySelector('[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(API.get).toHaveBeenLastCalledWith('/api/knowledge-admin/activities?page=1&keyword=%E8%A7%84%E8%8C%83', { timeout: 15000 });
  expect(log.textContent).not.toContain('个人笔记');
  await act(async () => { button('返回知识库').click(); });
  expect(container.querySelector('[aria-label="知识库日志"]')).toBeNull();
});


test('knowledge history displays library, category and document deletions', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: {
    items: ['delete_base', 'delete_category', 'delete_document'].map((action, index) => ({
      id: index + 1, action, knowledge_base_name: '已删除资料', creator_id: 2, actor_id: 1,
      document_name: action === 'delete_document' ? '已删除文件.pdf' : '', status: 'success', created_at: '2026-11-20T10:00:00+08:00',
    })), total: 3, names: { 1: '管理员', 2: '爱丽丝' },
  } } });
  await act(async () => { root.render(<ActivityLog onClose={() => {}} />); });
  expect(container.textContent).toContain('删除知识库');
  expect(container.textContent).toContain('删除分类');
  expect(container.textContent).toContain('删除文件');
  expect(container.textContent).toContain('已删除文件.pdf');
  expect(container.textContent).toMatchSnapshot('deleted knowledge objects');
});
