import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExpertCategory from './ExpertCategory';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn() }, showError: jest.fn(), showSuccess: jest.fn() }));
jest.mock('@douyinfe/semi-ui', () => ({ Modal: { confirm: jest.fn() } }));

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test('categories show website counts without legacy expert or team counts', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: [{ id: 1, name: '办公工具', status: 1, expert_count: 99, web_expert_count: 2, team_count: 88 }] } });
  const container = document.createElement('div');
  const root = createRoot(container);
  // eslint-disable-next-line testing-library/no-unnecessary-act -- This is a raw React root, not a Testing Library render helper.
  await act(async () => { root.render(<ExpertCategory />); });
  expect([...container.querySelectorAll('.header span')].map(item => item.textContent)).toEqual(['分类名称', '描述', '专家数量', '状态', '操作']);
  expect(container.querySelector('.expert-category-row:not(.header)').children[2].textContent).toBe('2');
  expect(container.textContent).not.toContain('专家团');
  await act(async () => { root.unmount(); });
});
