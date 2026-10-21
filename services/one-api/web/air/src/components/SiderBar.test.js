/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SiderBar from './SiderBar';
import { hasPermission } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn() }, isRoot: () => false, hasPermission: jest.fn() }));

test('release navigation follows permission and highlights the active page', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(<MemoryRouter initialEntries={['/operation/version-release']}><SiderBar isCollapsed={false} onCollapseChange={() => {}} /></MemoryRouter>);
  try {
    hasPermission.mockReturnValue(false);
    act(render);
    expect(container.querySelector('a[href="/operation/version-release"]')).toBeNull();
    hasPermission.mockReturnValue(true);
    act(render);
    const link = container.querySelector('a[href="/operation/version-release"]');
    expect(link.textContent).toBe('版本发布');
    expect(container.querySelector('a[href="/knowledge"]').textContent).toBe('知识库');
    expect(link.classList.contains('active')).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
