/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Drives administrator selection and confirmations through a raw React root. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkillsTable from './SkillsTable';
import { API } from '../helpers';
import { Modal } from '@douyinfe/semi-ui';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('./SkillBrowseDrawer', () => () => null);
jest.mock('@douyinfe/semi-ui', () => ({
  Modal: { confirm: jest.fn() },
  Tag: ({ children }) => <span>{children}</span>, Tooltip: ({ children }) => <>{children}</>,
  Table: ({ dataSource, rowSelection, pagination }) => <div>
    <span>第 {pagination.currentPage} 页</span>
    <button onClick={() => pagination.onPageChange(pagination.currentPage + 1)}>下一页</button>
    {dataSource.slice((pagination.currentPage - 1) * 20, pagination.currentPage * 20).map(record => <div key={record._rowKey}>
      {rowSelection && <input type='checkbox' aria-label={`选择 ${record.name}`} checked={rowSelection.selectedRowKeys.includes(record._rowKey)}
        disabled={rowSelection.getCheckboxProps(record).disabled} onChange={event => rowSelection.onChange(event.target.checked
          ? [...rowSelection.selectedRowKeys, record._rowKey] : rowSelection.selectedRowKeys.filter(key => key !== record._rowKey))} />}
      {record.name}
    </div>)}
  </div>,
}));

let root, container;
const click = async text => act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text).click());
beforeEach(async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  const records = Array.from({ length: 21 }, (_, index) => ({ id: index + 1, name: `skill-${index + 1}`, status: 1 }));
  API.get.mockImplementation(async url => ({ data: url === '/api/skill/admin/list' ? { items: records } : { items: [], data: [] } }));
  API.post.mockResolvedValue({ data: { success: true } });
  API.delete.mockResolvedValue({ data: { success: true } });
  container = document.createElement('div'); root = createRoot(container);
  await act(async () => root.render(<SkillsTable />));
});
afterEach(async () => { await act(async () => root.unmount()); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('shows batch selection only on request and requires confirmation before deleting', async () => {
  expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  await click('批量管理');
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '批量删除').disabled).toBe(true);
  await act(async () => container.querySelector('input[aria-label="选择 skill-1"]').click());
  await click('批量删除');
  expect(API.delete).not.toHaveBeenCalled();
  const confirmation = Modal.confirm.mock.calls[0][0];
  expect(confirmation.okType).toBe('danger');
  await act(async () => confirmation.onOk());
  expect(API.delete).toHaveBeenCalledWith('/api/skill/1');
  expect(container.textContent).toContain('成功 1 个，失败 0 个，跳过 0 个');
});

test('keeps selections across pages and clears them on source changes', async () => {
  await click('批量管理');
  await click('全选当前页');
  expect(container.textContent).toContain('已选 20 个技能');
  await click('下一页');
  await click('全选当前页');
  expect(container.textContent).toContain('已选 21 个技能');
  await click('官方');
  expect(container.textContent).toContain('已选 0 个技能');
  expect(container.textContent).toContain('第 1 页');
});

test('retains failed selections and the current page for retry after partial batch failure', async () => {
  await click('批量管理'); await click('全选当前页'); await click('下一页'); await click('全选当前页');
  API.post.mockImplementation(async url => ({ data: { success: !url.includes('/1/'), message: '失败原因' } }));
  await click('批量下架');
  await act(async () => Modal.confirm.mock.calls[0][0].onOk());
  expect(container.textContent).toContain('成功 20 个，失败 1 个，跳过 0 个');
  expect(container.textContent).toContain('已选 1 个技能');
  expect(container.textContent).toContain('失败原因');
  expect(container.textContent).toContain('第 2 页');
});
