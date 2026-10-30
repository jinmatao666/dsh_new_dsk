import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import UserProfile from './UserProfile';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn() } }));
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); jest.clearAllMocks(); delete global.IS_REACT_ACT_ENVIRONMENT; });

const profile = () => ({
  from: '2026-09-28', to: '2026-10-27',
  models: { count: 13, prompt_tokens: 100, completion_tokens: 20, top: [{ name: 'qwen', count: 13 }], days: [{ day: '2026-09-28', count: 1 }, { day: '2026-10-27', count: 12 }] },
  skills: { count: 1, top: [{ name: '文档处理', count: 1 }], days: [{ day: '2026-10-27', count: 1 }] },
  experts: { count: 0, top: [], days: [] },
  downloads: { count: 2, installed_count: 12, top: Array.from({ length: 12 }, (_, index) => ({ name: `技能 ${index + 1}`, download_count: index < 2 ? 2 : 1 })) },
});

test('charts include both Beijing date boundaries and show installations without an invalid conversion rate', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: profile() } });
  await act(async () => root.render(<UserProfile user={{ id: 2, username: 'Admin', role: 100, status: 1 }} />));
  const bars = [...container.querySelectorAll('.user-profile-bar')];
  const calendar = [...container.querySelectorAll('.user-profile-heatmap-grid > i')];
  expect(bars).toHaveLength(30);
  expect(calendar).toHaveLength(30);
  expect(bars[0].title).toContain('2026-09-28：模型 1');
  expect(bars[29].title).toContain('2026-10-27：模型 12，技能 1');
  expect(calendar[0].title).toBe('2026-09-28：1 次');
  expect(calendar[29].title).toBe('2026-10-27：13 次');
  expect(container.querySelector('.user-profile-trend-summary strong').textContent).toBe('14次活动');
  expect(container.querySelector('.user-profile-insights').textContent).not.toContain('2450');
  expect(container.querySelector('.user-profile-insights').textContent).not.toContain('转化');
  expect(container.querySelector('.user-profile-insights').textContent).toContain('12个');
  expect(container.querySelectorAll('.user-profile-installed-grid tbody tr')).toHaveLength(10);
  expect([...container.querySelectorAll('.user-profile-installed-grid tbody')].map(body => body.querySelectorAll('tr').length)).toEqual([5, 5]);
  await act(async () => container.querySelector('.user-profile-installed-toggle').click());
  expect(container.querySelectorAll('.user-profile-installed-grid tbody tr')).toHaveLength(12);
  expect(container.querySelector('.user-profile-installed-toggle').textContent).toBe('收起');
  expect({
    identity: container.querySelector('.user-profile-identity').textContent,
    insights: [...container.querySelectorAll('.user-profile-insights > div')].map(item => item.textContent),
    downloads: [...container.querySelectorAll('.user-profile-downloads tr')].map(item => item.textContent),
  }).toMatchSnapshot();
});

test('renders observed empty data without invented activity or installation claims', async () => {
  const data = profile();
  for (const key of ['models', 'skills', 'experts']) { data[key].count = 0; data[key].top = []; data[key].days = []; }
  data.downloads = { count: 0, installed_count: 0, top: [] };
  API.get.mockResolvedValue({ data: { success: true, data } });
  await act(async () => root.render(<UserProfile user={{ id: 2, username: 'Admin' }} />));
  expect(container.textContent).toContain('尚无可用于生成画像的使用记录');
  expect(container.querySelector('.user-profile-trend').textContent).toContain('这段时间暂无使用记录');
  expect(container.querySelectorAll('.user-profile-heatmap-grid > .empty')).toHaveLength(30);
});
