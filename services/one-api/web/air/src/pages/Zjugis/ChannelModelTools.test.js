/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots need explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ChannelModelBatch, ChannelModelPicker, filterChannelModels } from './ChannelModelTools';
import { ModelConfigPage } from './index';
import { API } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, copy: jest.fn() }));
jest.mock('../../components/RolePermissions', () => () => null);
jest.mock('../../components/CustomSelect', () => ({ children, ...props }) => <select {...props}>{children}</select>);
const channels = [{ id: 1, name: '渠道 a', models: 'shared,new-a' }, { id: 2, name: '渠道 b', models: 'shared,new-b' }];
const definitions = [{ id: 1, name: 'shared', display_name: '原名称', enabled: true, sources: [{ channel_id: 1, channel_name: '渠道 a' }, { channel_id: 2, channel_name: '渠道 b' }] }, { id: 2, name: 'orphan', sources: [] }];
let root, container;
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const click = async text => act(async () => button(text).click());
const changeSelect = async (node, value) => act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); });
const changeInput = async (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});
const Modal = ({ children }) => <div role='dialog'>{children}</div>;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  API.get.mockImplementation(async path => ({ data: { success: true, data: path.startsWith('/api/channel/') || path === '/api/model_definition/channels' ? channels : path === '/api/model_definition/aggregated' ? definitions : [] } }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test('channel filters include multi-source models and distinguish unbound definitions', () => {
  expect(filterChannelModels(definitions, '1').map(item => item.name)).toEqual(['shared']);
  expect(filterChannelModels(definitions, '2').map(item => item.name)).toEqual(['shared']);
  expect(filterChannelModels(definitions, 'unbound').map(item => item.name)).toEqual(['orphan']);
});

test('actual model page filters sources and tests only the selected channel', async () => {
  await act(async () => root.render(<ModelConfigPage />));
  await click('模型配置');
  const heading = container.querySelector('.channel-model-heading');
  expect(heading.querySelector('h2').textContent).toBe('模型定义');
  expect(heading.querySelector('select[aria-label="筛选来源渠道"]').value).toBe('all');
  expect(heading.querySelector('.channel-model-count').textContent).toBe('共 2 个模型');
  await changeSelect(container.querySelector('select[aria-label="筛选来源渠道"]'), '2');
  expect(heading.querySelector('.channel-model-count').textContent).toBe('共 1 个模型');
  const table = container.querySelector('.preview-surface tbody');
  expect(table.textContent).toContain('渠道 b');
  expect(table.textContent).not.toContain('渠道 a');
  expect(table.textContent).not.toContain('orphan');
  await click('测试当前列表');
  expect(API.get).toHaveBeenCalledWith('/api/model_definition/test?model=shared&channel_id=2');
});

test('single creation gates the picker on channel selection and clears stale model IDs', async () => {
  await act(async () => root.render(<ModelConfigPage />));
  await click('模型配置'); await click('＋ 添加模型');
  expect(container.querySelector('[role=combobox]').disabled).toBe(true);
  const source = container.querySelector('.zjugis-modal select');
  await changeSelect(source, '1');
  const input = container.querySelector('[role=combobox]');
  act(() => input.focus()); await changeInput(input, 'new');
  expect([...container.querySelectorAll('[role=option]')].map(node => node.textContent)).toEqual(['new-a']);
  await act(async () => container.querySelector('[role=option]').click());
  expect(input.value).toBe('new-a');
  await changeSelect(source, '2');
  expect(container.querySelector('[role=combobox]').value).toBe('');
});

test('batch starts unselected, skips already-bound models and retries failures without repeating success', async () => {
  const onSaved = jest.fn();
  const batchChannels = [{ ...channels[0], models: 'shared,new-a,new-c' }];
  await act(async () => root.render(<ChannelModelBatch channels={batchChannels} definitions={definitions} Modal={Modal} onSaved={onSaved} onClose={() => {}} />));
  await changeSelect(container.querySelector('select'), '1');
  expect(container.querySelector('input[type=checkbox]').disabled).toBe(true);
  expect([...container.querySelectorAll('input[type=checkbox]')].some(node => node.checked)).toBe(false);
  await click('全选'); await click('反选'); expect(button('下一步').disabled).toBe(true);
  await click('全选'); await click('下一步');
  API.post.mockResolvedValueOnce({ data: { success: true, status: 'created' } });
  API.post.mockResolvedValueOnce({ data: { success: false, message: '临时失败' } });
  await click('批量保存');
  expect(container.textContent).toContain('临时失败');
  API.post.mockResolvedValueOnce({ data: { success: true, status: 'created' } });
  await click('重试失败项');
  expect(container.textContent).toContain('已新增（默认禁用）');
  expect(API.post).toHaveBeenCalledTimes(3);
  expect(API.post.mock.calls[0][1].channel_id).toBe(1);
  expect(API.post.mock.calls[0][1].definition.name).toBe('new-a');
  expect(API.post.mock.calls[2][1].definition.name).toBe('new-c');
  expect(button('重试失败项').disabled).toBe(true);
});

test('picker typing is a search, never a freeform model selection', async () => {
  const onChange = jest.fn();
  await act(async () => root.render(<ChannelModelPicker names={['known']} value='' onChange={onChange} disabled={false} />));
  const input = container.querySelector('input'); act(() => input.focus());
  await changeInput(input, 'unknown');
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).toContain('无匹配模型');
});
