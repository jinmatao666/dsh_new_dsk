/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Renders the user table with its real persisted column configuration. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import UsersTable from './UsersTable';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn() }, isRoot: () => true, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('../pages/User/AddUser', () => () => null);
jest.mock('../pages/User/EditUser', () => () => null);
jest.mock('./UserTokensSubTable', () => () => null);
jest.mock('./UserActivityModal', () => () => null);
jest.mock('./ColumnSelector', () => () => null);
jest.mock('@douyinfe/semi-ui', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  const Dropdown = Wrapper;
  Dropdown.Menu = Wrapper;
  Dropdown.Item = Wrapper;
  return {
    Button: Wrapper, Input: () => null, Modal: () => null, Dropdown,
    Typography: { Text: Wrapper }, Tag: Wrapper, Tooltip: Wrapper,
    Table: ({ columns, dataSource }) => <table><thead><tr>{columns.map(column => <th key={column.dataIndex}>{column.title}</th>)}</tr></thead><tbody>{dataSource.map(record => <tr key={record.id}>{columns.map(column => <td key={column.dataIndex}>{['username', 'unit_name', 'department_name'].includes(column.dataIndex) ? (column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]) : null}</td>)}</tr>)}</tbody></table>
  };
});

test('shows unit and department even with stored old columns, hides billing columns', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('users_table_visible_columns', JSON.stringify(['account_id', 'username', 'group', 'account_type', 'operate']));
  API.get.mockResolvedValue({ data: { success: true, data: [{ id: 1, username: 'tester', unit_name: '单位甲', department_name: '部门甲' }, { id: 2, username: 'empty' }] } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<UsersTable />));
    const headings = [...container.querySelectorAll('th')].map(item => item.textContent);
    expect(headings).toContain('所属单位');
    expect(headings).toContain('所属部门');
    expect(headings).not.toContain('分组');
    expect(headings).not.toContain('账户类型');
    expect(container.textContent).toContain('单位甲');
    expect(container.textContent).toContain('部门甲');
    expect(container.textContent).toContain('—');
    expect({ headings, rows: [...container.querySelectorAll('tbody tr')].map(row => row.textContent) }).toMatchSnapshot();
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
