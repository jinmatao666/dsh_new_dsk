import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Expert from './index';

jest.mock('../../components/ExpertWebTable', () => () => <div>专家网站配置</div>);
jest.mock('../../components/ExpertCategory', () => () => <div>专家分类配置</div>);

beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

test('expert management exposes only website experts and categories', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  // eslint-disable-next-line testing-library/no-unnecessary-act -- This is a raw React root, not a Testing Library render helper.
  act(() => { root.render(<Expert />); });
  const buttons = [...container.querySelectorAll('nav button')];
  expect(buttons.map(button => button.textContent)).toEqual(['专家', '分类管理']);
  expect(container.textContent).toContain('专家网站配置');
  expect(container.textContent).not.toContain('旧版工作台');
  expect(container.textContent).not.toContain('专家团');
  act(() => { buttons[1].click(); });
  expect(container.textContent).toContain('专家分类配置');
  expect(container.textContent).not.toContain('专家网站配置');
  act(() => { root.unmount(); });
  container.remove();
});
