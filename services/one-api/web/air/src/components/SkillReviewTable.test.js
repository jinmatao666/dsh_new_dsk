/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Uses a raw React root and a minimal table renderer. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkillReviewTable from './SkillReviewTable';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn(), timestamp2string: value => String(value) }));
jest.mock('./SkillBrowseDrawer', () => ({ visible, onTest }) => visible ? <div>{onTest && <button onClick={onTest}>详情测试</button>}</div> : null);
jest.mock('@douyinfe/semi-ui', () => ({
  Modal: () => null, Tag: ({ children }) => <span>{children}</span>, TextArea: () => null,
  Table: ({ dataSource, columns }) => <div>{dataSource.map(skill => <div key={skill.id}>{columns[columns.length - 1].render(null, skill)}</div>)}</div>
}));

test('only pending submissions have list and detail test actions', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockResolvedValue({ data: { items: [{ id: 7, review_status: 'pending' }, { id: 8, review_status: 'approved' }], totalItems: 2 } });
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<SkillReviewTable />));
    const tests = [...container.querySelectorAll('button')].filter(node => node.textContent === '测试');
    expect(tests).toHaveLength(1);
    await act(async () => tests[0].click());
    expect(open).toHaveBeenCalledWith('/skill/reviews/7/test', '_blank', 'noopener');
    const browse = [...container.querySelectorAll('button')].filter(node => node.textContent === '浏览');
    await act(async () => browse[0].click());
    expect(container.textContent).toContain('详情测试');
    await act(async () => browse[1].click());
    expect(container.textContent).not.toContain('详情测试');
  } finally {
    await act(async () => root.unmount()); open.mockRestore(); delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
