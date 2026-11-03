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

test('explicit cache uses a dropdown, disables own channels and preserves model enabled state', async () => {
  const oldGet = API.get.getMockImplementation();
  API.get.mockImplementation(async path => path === '/api/model_definition/channels'
    ? { data: { success: true, data: [{ ...channels[0], explicit_cache_allowed: false }, { ...channels[1], explicit_cache_allowed: true }] } }
    : path === '/api/model_definition/aggregated'
      ? { data: { success: true, data: [{ ...definitions[0], support_explicit_cache: true, sources: [definitions[0].sources[0]] }] } }
      : oldGet(path));
  API.put.mockResolvedValue({ data: { success: true } });
  API.post.mockResolvedValue({ data: { success: true } });
  await act(async () => root.render(<ModelConfigPage />));
  await click('模型配置');
  await click('编辑');
  const dialog = container.querySelector('.zjugis-modal');
  expect(dialog.textContent).not.toContain('启用模型');
  const cache = dialog.querySelector('select[aria-label="显式缓存"]');
  expect(cache.disabled).toBe(true);
  expect(cache.value).toBe('off');
  const source = [...dialog.querySelectorAll('.zjugis-field')].find(field => field.textContent.startsWith('来源渠道')).querySelector('select');
  await changeSelect(source, '2');
  expect(cache.disabled).toBe(false);
  expect(cache.value).toBe('on');
  await changeSelect(cache, 'off');
  expect(cache.value).toBe('off');
  await changeSelect(source, '1');
  expect(cache.disabled).toBe(true);
  expect(cache.value).toBe('off');
  await act(async () => dialog.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = API.put.mock.calls.find(([path]) => path === '/api/model_definition/')[1];
  expect(saved.enabled).toBe(true);
  expect(saved.support_explicit_cache).toBe(false);
});

test('model credit preview converts legacy output, updates prices, and saves separately', async () => {
  const previousGet = API.get.getMockImplementation();
  API.get.mockImplementation(async path => path === '/api/option/'
    ? { data: { success: true, data: [{ key: 'SystemDeploymentSettings', value: '{"creditPricingBase":2}' }] } }
    : path === '/api/model_definition/aggregated'
      ? { data: { success: true, data: [{ ...definitions[0], model_ratio: 0.15, completion_ratio: 4 }] } }
      : previousGet(path));
  API.put.mockResolvedValue({ data: { success: true } });
  API.post.mockResolvedValue({ data: { success: true } });
  await act(async () => root.render(<ModelConfigPage />));
  await click('模型配置');
  expect(container.querySelector('.model-definition-ratios').textContent).toBe('0.15× / 0.6×');
  expect(container.querySelector('.model-definition-name strong').title).toBe('shared');
  await click('编辑');
  const fields = [...container.querySelectorAll('.model-credit-pricing input')];
  expect(fields[0].value).toBe('0.15');
  expect(fields[1].readOnly).toBe(true);
  expect(fields[1].value).toBe('0.3');
  expect(fields[2].value).toBe('0.6');
  expect(fields[3].value).toBe('1.2');
  expect(fields[8].value).toBe('0.375');
  await changeInput(fields[2], '0.8');
  expect(fields[3].value).toBe('1.6');
  expect(fields[8].value).toBe('0.475');
  await changeInput(fields[8], '0.7');
  await changeInput(fields[2], '1');
  expect(fields[8].value).toBe('0.7');
  await click('恢复默认');
  expect(Number(fields[8].value)).toBe(0.575);
  await changeInput(fields[2], '0.8');
  await changeInput(fields[8], '0.7');
  await act(async () => container.querySelector('.model-credit-pricing').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const options = API.put.mock.calls.filter(([path]) => path === '/api/option/').map(([, body]) => body);
  expect(options).toEqual([{ key: 'ModelCreditPricing', value: '{"shared":{"input":0.15,"output":0.8,"cache_read":0.15,"cache_write":0.15,"display":0.7}}' }]);
});

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

test('picker accepts a manual model ID when discovery has no matching result', async () => {
  const onChange = jest.fn();
  await act(async () => root.render(<ChannelModelPicker names={['known']} value='' onChange={onChange} disabled={false} />));
  const input = container.querySelector('input'); act(() => input.focus());
  await changeInput(input, 'unknown');
  expect(onChange).toHaveBeenLastCalledWith('unknown');
  expect(container.textContent).toContain('无匹配模型');
  expect(container.textContent).toContain('可直接填写模型 ID 后保存');
});

test('a channel saves without fetching or selecting any models', async () => {
  API.post.mockResolvedValue({ data: { success: true } });
  await act(async () => root.render(<ModelConfigPage />));
  await click('＋ 添加模型渠道');
  await changeInput(container.querySelector('.zjugis-modal input'), 'manual-only');
  await act(async () => container.querySelector('.zjugis-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(API.post).toHaveBeenCalledWith('/api/channel/', expect.objectContaining({ name: 'manual-only', models: '' }));
  expect(API.post).not.toHaveBeenCalledWith('/api/channel/fetch_models', expect.anything());
});

test('a manual model ID saves and binds to a channel with an empty model list', async () => {
  API.get.mockImplementation(async path => ({ data: { success: true, data: path === '/api/model_definition/channels' ? [{ ...channels[0], models: '' }] : path === '/api/model_definition/aggregated' ? definitions : [] } }));
  API.post.mockResolvedValue({ data: { success: true, data: {} } });
  API.put.mockResolvedValue({ data: { success: true } });
  await act(async () => root.render(<ModelConfigPage />));
  await click('模型配置'); await click('＋ 添加模型');
  await changeSelect(container.querySelector('.zjugis-modal select'), '1');
  const input = container.querySelector('[role=combobox]');
  act(() => input.focus()); await changeInput(input, '  manual-id  ');
  act(() => input.blur());
  expect(input.value).toBe('  manual-id  ');
  await act(async () => container.querySelector('.zjugis-modal form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(API.post).toHaveBeenCalledWith('/api/model_definition/', expect.objectContaining({ name: 'manual-id', source_channel_id: 1 }));
  expect(API.post).toHaveBeenCalledWith('/api/model_definition/source', { model: 'manual-id', channel_id: 1, group: 'default' });
});
