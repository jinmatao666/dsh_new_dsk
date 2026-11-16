/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Exercises controlled table pagination and row actions through a raw React root. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkillsTable from './SkillsTable';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('./SkillBrowseDrawer', () => () => null);
jest.mock('@douyinfe/semi-ui', () => ({
  Table: ({ dataSource, columns, pagination }) => {
    const page = pagination.currentPage || 1;
    const record = dataSource[(page - 1) * pagination.pageSize];
    return <div>
      <span data-testid='page'>第 {page} 页</span>
      <button onClick={() => pagination.onPageChange(page + 1)}>下一页</button>
      {record && columns[columns.length - 1].render(null, record)}
    </div>;
  }
}));

test('unpublishing a third-page skill keeps the third page after reloading records', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const records = Array.from({ length: 61 }, (_, index) => ({ id: index + 1, name: `skill-${index}`, status: 1 }));
  API.get.mockImplementation(async url => ({ data: url === '/api/skill/admin/list' ? { items: records.map(item => ({ ...item })) } : { items: [], data: [] } }));
  API.post.mockImplementation(async () => { records[40].status = 0; return { data: { success: true } }; });
  const container = document.createElement('div');
  const root = createRoot(container);
  const click = async text => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text).click());
  try {
    await act(async () => root.render(<SkillsTable />));
    await click('下一页');
    await click('下一页');
    expect(container.textContent).toContain('第 3 页');
    await click('下架');
    expect(API.post).toHaveBeenCalledWith('/api/skill/41/unpublish');
    expect(container.textContent).toContain('第 3 页');
    expect([...container.querySelectorAll('button')].some(button => button.textContent === '上架')).toBe(true);
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('opens a skill charge point dialog from 积分 before 删除', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockImplementation(async url => ({ data: url === '/api/skill/admin/list'
    ? { items: [{ id: 1, name: 'contract', display_name: '合同起草', status: 1 }] }
    : { success: true, items: [], data: [] } }));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SkillsTable />));
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === '积分');
    expect(button.nextElementSibling.textContent).toBe('删除');
    await act(async () => button.click());
    expect(API.get).toHaveBeenCalledWith('/api/billing/v1/resources/skill/contract/charge-points');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).not.toContain('任务积分（积分／次）');
  } finally {
    await act(async () => root.unmount()); container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
