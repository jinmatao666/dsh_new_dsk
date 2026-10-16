/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access -- Exercises native file inputs through a raw React root. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkillsTable from './SkillsTable';
import { API } from '../helpers';

jest.mock('../helpers', () => ({ API: { get: jest.fn(), post: jest.fn() }, showError: jest.fn() }));
jest.mock('./SkillBrowseDrawer', () => () => null);
jest.mock('./skillDownload', () => ({ createZip: () => new Blob(['zip']) }));
jest.mock('@douyinfe/semi-ui', () => ({ Table: () => null }));

test('multiple ZIP selection shows independent success and failure results without publishing', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockResolvedValue({ data: { items: [], data: [] } });
  API.post.mockImplementation(async (url, data) => {
    if (data.get('package').name === 'bad.zip') {
      const error = new Error('Rejected');
      error.response = { data: { message: '版本已存在' } };
      throw error;
    }
    return { data: { success: true, data: { skill: { name: 'good' }, release: { version: '0.1.0' } } } };
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SkillsTable />));
    const input = container.querySelector('input[accept=".zip,application/zip"]');
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, 'files', { value: [new File(['zip'], 'bad.zip'), new File(['zip'], 'good.zip')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(API.post).toHaveBeenCalledTimes(2);
    expect(API.post.mock.calls.every(([url]) => url === '/api/skill/admin/import')).toBe(true);
    expect(container.textContent).toContain('成功 1 个，失败 1 个');
    expect(container.textContent).toContain('版本已存在');
    expect(container.textContent).toContain('good.zip');
    expect(container.textContent).toContain('未上架');
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('parent folder input uploads one package for each child without requiring manifests', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockResolvedValue({ data: { items: [], data: [] } });
  API.post.mockResolvedValue({ data: { success: true, data: { skill: { name: 'skill' }, release: { version: '0.1.0' } } } });
  const files = ['skills/first/SKILL.md', 'skills/first/scripts/run.py', 'skills/second/SKILL.md'].map(path => ({
    name: path.split('/').pop(), size: 4, webkitRelativePath: path,
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
  }));
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SkillsTable />));
    const input = container.querySelector('input[webkitdirectory]');
    Object.defineProperty(input, 'files', { value: files });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(API.post.mock.calls.map(([, data]) => data.get('package').name)).toEqual(['first.zip', 'second.zip']);
    expect(container.textContent).toContain('成功 2 个，失败 0 个');
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test('importing a draft for a published skill explains pending update and preserves the published version', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  API.get.mockResolvedValue({ data: { items: [], data: [] } });
  API.post.mockResolvedValue({ data: { success: true, data: {
    skill: { name: 'document-check', display_name: '公文要素检查', status: 1, version: '1.0.0' },
    release: { version: '1.1.0', state: 'unpublished' }
  } } });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SkillsTable />));
    const input = container.querySelector('input[accept=".zip,application/zip"]');
    Object.defineProperty(input, 'files', { value: [new File(['zip'], 'document-check.zip')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('公文要素检查 · v1.1.0');
    expect(container.textContent).toContain('待更新：旧版本 v1.0.0 仍已上架');
    expect(container.textContent).toContain('在版本管理中上架新版本');
    expect(container.textContent).not.toContain('未上架：请在列表中');
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(API.post.mock.calls[0][0]).toBe('/api/skill/admin/import');
  } finally {
    await act(async () => root.unmount());
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
