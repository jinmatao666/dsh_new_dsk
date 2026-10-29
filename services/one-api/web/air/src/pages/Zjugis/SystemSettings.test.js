/* eslint-disable testing-library/no-unnecessary-act -- ReactDOM roots, not Testing Library helpers, require explicit act. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SystemSettings from './SystemSettings';
import { API, showSuccess } from '../../helpers';

jest.mock('../../helpers', () => ({ API: { get: jest.fn(), put: jest.fn() }, showSuccess: jest.fn() }));
let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  API.get.mockImplementation(path => Promise.resolve({ data: { success: true, data: path === '/api/user/self' ? { username: 'root', role: 100 } : [{ key: 'SystemDeploymentSettings', value: JSON.stringify({ network: 'internet', operator: '张运维', phone: '0571-12345678' }) }] } }));
  API.put.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); jest.useRealTimers(); delete global.IS_REACT_ACT_ENVIRONMENT; });
test('legacy feature switches load and save with knowledge defaults without resetting other settings', async () => {
  const legacy = { network: 'intranet', operator: '运维', phone: '123', features: {
    internet: { automations: false, connectors: true }, intranet: { automations: true, connectors: false },
  }, resources: { source: 'proxy', transport: 'tunnel', proxyUrl: '', autoDetect: false, probeUrls: [] } };
  API.get.mockImplementation(path => Promise.resolve({ data: { success: true, data: path === '/api/user/self'
    ? { username: 'root', role: 100 } : [{ key: 'SystemDeploymentSettings', value: JSON.stringify(legacy) }] } }));
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[4].click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  const switches = [...container.querySelectorAll('[role="switch"]')];
  expect(switches.map(toggle => toggle.checked)).toEqual([false, true, true, false, true, true]);
  act(() => switches[4].click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = JSON.parse(API.put.mock.calls[0][1].value);
  expect(saved.features).toEqual({ internet: { ...legacy.features.internet, knowledgeBases: false }, intranet: { ...legacy.features.intranet, knowledgeBases: true } });
  expect(saved.network).toBe(legacy.network);
  expect(saved.resources).toEqual(legacy.resources);
});

test.each([null, 'true', 1])('rejects an explicitly invalid knowledge flag %p', async knowledgeBases => {
  const value = { network: 'internet', features: {
    internet: { automations: true, connectors: true, knowledgeBases },
    intranet: { automations: true, connectors: false },
  } };
  API.get.mockImplementation(path => Promise.resolve({ data: { success: true, data: path === '/api/user/self'
    ? { username: 'root', role: 100 } : [{ key: 'SystemDeploymentSettings', value: JSON.stringify(value) }] } }));
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[4].click());
  expect(container.querySelector('[role="alert"]').textContent).toContain('功能设置无效');
  expect(API.put).not.toHaveBeenCalled();
});

test('seven tabs preserve profile and security, and load deployment contacts', async () => {
  await act(async () => root.render(<SystemSettings />));
  const tabs = [...container.querySelectorAll('[role="tab"]')];
  expect(tabs.map(button => button.textContent)).toEqual(['账户设置', '安全设置', '网络设置', '版本类型', '功能设置', '运维设置', '插件设置']);
  expect(container.textContent).toContain('root');
  act(() => tabs[1].click()); expect(container.textContent).toContain('会话有效期');
  act(() => tabs[5].click());
  expect(container.querySelector('input').value).toBe('张运维');
  expect(container.querySelector('input[type="tel"]').value).toBe('0571-12345678');
});

test('plugin administrator switch saves independently and cancellation restores its saved value', async () => {
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[6].click());
  const toggle = container.querySelector('[aria-label="统一启用浏览器助手"]');
  expect(toggle.checked).toBe(true);
  act(() => toggle.click());
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '取消修改').click());
  expect(toggle.checked).toBe(true);
  act(() => toggle.click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const value = JSON.parse(API.put.mock.calls[0][1].value);
  expect(value.plugins).toEqual({ browserAssistant: false });
  expect(value.network).toBe('internet');
  expect(value.operator).toBe('张运维');
  expect(value.features.internet.connectors).toBe(true);
  expect(value.features.internet.knowledgeBases).toBe(true);
});

test('non-root administrator cannot modify plugin settings', async () => {
  API.get.mockResolvedValue({ data: { success: true, data: { username: 'admin', role: 10 } } });
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[6].click());
  expect(container.textContent).toContain('仅超级管理员');
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(API.put).not.toHaveBeenCalled();
});
test('network selection saves one deployment option without changing account data', async () => {
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  act(() => container.querySelector('input[value="intranet"]').click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = JSON.parse(API.put.mock.calls[0][1].value);
  expect(saved.network).toBe('intranet');
  expect(saved.operator).toBe('张运维');
  expect(saved.features).toEqual({ internet: { automations: true, connectors: true, knowledgeBases: true }, intranet: { automations: true, connectors: false, knowledgeBases: true } });
  expect(showSuccess).toHaveBeenCalledWith('设置已保存');
  expect(container.textContent).not.toContain('设置已保存');
  expect(container.textContent).not.toContain('所有修改已保存');
  expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
});

test('saving deployment settings clears hidden resource options even without editing resources', async () => {
  const resources = { source: 'proxy', transport: 'forward', proxyUrl: 'http://backend.example:3300', bypassHosts: ['internal.example'], autoDetect: false, probeUrls: [] };
  API.get.mockImplementation(path => Promise.resolve({ data: { success: true, data: path === '/api/user/self'
    ? { username: 'root', role: 100 }
    : [{ key: 'SystemDeploymentSettings', value: JSON.stringify({ network: 'internet', operator: '', phone: '', resources }) }] } }));
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  act(() => container.querySelector('input[value="intranet"]').click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(JSON.parse(API.put.mock.calls[0][1].value).resources).toEqual({
    source: 'proxy', transport: 'tunnel', proxyUrl: resources.proxyUrl, autoDetect: false, probeUrls: [],
  });
});

test('feature switches save independently for internet and intranet', async () => {
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[4].click());
  const toggle = label => container.querySelector(`input[aria-label="${label}"]`);
  act(() => toggle('互联网自动化').click());
  act(() => toggle('纯内网连接器').click());
  act(() => toggle('互联网知识库').click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(JSON.parse(API.put.mock.calls[0][1].value).features).toEqual({ internet: { automations: false, connectors: true, knowledgeBases: false }, intranet: { automations: true, connectors: true, knowledgeBases: true } });
  expect(toggle('纯内网自动化').checked).toBe(true);
});

test('edition selection saves independently and can be cancelled', async () => {
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[3].click());
  expect(container.querySelector('input[value="operations"]').checked).toBe(true);
  act(() => container.querySelector('input[value="government"]').click());
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '取消修改').click());
  expect(container.querySelector('input[value="operations"]').checked).toBe(true);
  act(() => container.querySelector('input[value="government"]').click());
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = JSON.parse(API.put.mock.calls[0][1].value);
  expect(saved.edition).toBe('government');
  expect(saved.network).toBe('internet');
  expect(saved.operator).toBe('张运维');
  expect(showSuccess).toHaveBeenCalledWith('设置已保存');
});

test('automatically recovers from a transient options request failure', async () => {
  jest.useFakeTimers();
  const normal = API.get.getMockImplementation();
  let optionsCalls = 0;
  API.get.mockImplementation((path, config) => {
    if (path === '/api/option/' && optionsCalls++ === 0) return Promise.reject({ code: 'ERR_NETWORK' });
    return normal(path, config);
  });
  await act(async () => root.render(<SystemSettings />));
  expect(container.textContent).toContain('正在加载设置');
  await act(async () => jest.advanceTimersByTime(500));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  expect(optionsCalls).toBe(2);
  expect(container.querySelector('input[value="internet"]').checked).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test('shows permission errors without retrying and supports manual reload', async () => {
  const normal = API.get.getMockImplementation();
  API.get.mockImplementation(path => path === '/api/option/'
    ? Promise.resolve({ data: { success: false, message: '无权进行此操作，权限不足' } }) : normal(path));
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  expect(container.querySelector('[role="alert"]').textContent).toContain('权限不足');
  expect(API.get.mock.calls.filter(([path]) => path === '/api/option/')).toHaveLength(1);
  expect(container.querySelector('form')).toBeNull();
  expect(API.put).not.toHaveBeenCalled();
  API.get.mockImplementation(normal);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重新加载').click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('input[value="internet"]')).not.toBeNull();
});

test('bounds transient retries and cancels pending retries on unmount', async () => {
  jest.useFakeTimers();
  API.get.mockRejectedValue({ code: 'ECONNABORTED' });
  await act(async () => root.render(<SystemSettings />));
  await act(async () => jest.advanceTimersByTime(500));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(API.get).toHaveBeenCalledTimes(3);
  expect(container.querySelector('[role="alert"]').textContent).toContain('暂时不可用');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重新加载').click());
  await act(async () => root.render(null));
  await act(async () => jest.advanceTimersByTime(2000));
  expect(API.get).toHaveBeenCalledTimes(4);
});

test('intranet skill and expert policies persist independently', async () => {
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  expect(container.querySelector('[name="internetSkillPolicy"]')).toBeNull();
  act(() => container.querySelector('[name="network"][value="intranet"]').click());
  const skills = [...container.querySelectorAll('[name="internetSkillPolicy"]')];
  const experts = [...container.querySelectorAll('[name="internetExpertPolicy"]')];
  expect(skills).toHaveLength(2);
  expect(experts).toHaveLength(2);
  expect(skills[1].checked).toBe(true);
  expect(experts[1].checked).toBe(true);
  act(() => skills[0].click());
  expect(skills[0].checked).toBe(true);
  expect(experts[1].checked).toBe(true);
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = JSON.parse(API.put.mock.calls[0][1].value);
  expect(saved.internetSkillPolicy).toBe('hide');
  expect(saved.internetExpertPolicy).toBe('disable');
});

test('legacy shared hide policy initializes both independent choices', async () => {
  API.get.mockImplementation(path => Promise.resolve({ data: { success: true, data: path === '/api/user/self'
    ? { role: 100 } : [{ key: 'SystemDeploymentSettings', value: JSON.stringify({ network: 'intranet', internetCatalogPolicy: 'hide' }) }] } }));
  await act(async () => root.render(<SystemSettings />));
  act(() => container.querySelectorAll('[role="tab"]')[2].click());
  expect(container.querySelector('[name="internetSkillPolicy"][value="hide"]').checked).toBe(true);
  expect(container.querySelector('[name="internetExpertPolicy"][value="hide"]').checked).toBe(true);
  act(() => container.querySelector('[name="internetExpertPolicy"][value="disable"]').click());
  expect(container.querySelector('[name="internetSkillPolicy"][value="hide"]').checked).toBe(true);
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === '取消修改').click());
  expect(container.querySelector('[name="internetExpertPolicy"][value="hide"]').checked).toBe(true);
});
