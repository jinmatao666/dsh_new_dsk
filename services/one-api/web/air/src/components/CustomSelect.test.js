/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CustomSelect from './CustomSelect';

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
const trigger = () => container.querySelector('button');
const menu = () => document.querySelector('[role="listbox"]');

test('portals the menu at trigger width and preserves native-style values', () => {
  const change = jest.fn();
  act(() => root.render(<CustomSelect value={0} onChange={change}><option value={0}>零</option><option>文本值</option></CustomSelect>));
  trigger().getBoundingClientRect = () => ({ left: 40, top: 80, bottom: 124, width: 320 });
  act(() => trigger().click());
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(menu().style.width).toBe('320px');
  expect(document.getElementById(trigger().getAttribute('aria-controls'))).toBe(menu());
  act(() => menu().querySelector('[value="文本值"]').click());
  expect(change).toHaveBeenCalledWith({ target: { value: '文本值' } });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test('keyboard skips disabled groups, Escape restores focus and outside click closes', () => {
  act(() => root.render(<CustomSelect value="a"><><option value="a">A</option></><optgroup disabled><option value="b">B</option></optgroup><option value="c">C</option></CustomSelect>));
  act(() => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement.value).toBe('a');
  expect(menu().querySelector('[value="b"]').disabled).toBe(true);
  act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement.value).toBe('c');
  act(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger());
  act(() => trigger().click());
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(menu()).toBeNull();
});

test('empty and disabled states do not leave a stale popup', () => {
  act(() => root.render(<CustomSelect />));
  act(() => trigger().click());
  expect(menu().textContent).toBe('暂无选项');
  act(() => root.render(<CustomSelect disabled />));
  expect(trigger().disabled).toBe(true); expect(menu()).toBeNull();
});
