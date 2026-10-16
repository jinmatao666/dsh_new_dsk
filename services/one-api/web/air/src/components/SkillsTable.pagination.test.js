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
