import { groupSkillFolders, zipSkillFolder, importSkillBatch } from './skillFolderImport';
import { createZip } from './skillDownload';

jest.mock('./skillDownload', () => ({ createZip: jest.fn(entries => entries) }));
beforeEach(() => createZip.mockImplementation(entries => entries));

const file = (path, content = 'test') => ({
  name: path.split('/').pop(), webkitRelativePath: path, size: content.length,
  arrayBuffer: async () => Uint8Array.from([...content].map(char => char.charCodeAt(0))).buffer
});

test('single skill without manifest preserves its scripts and binary attachments', async () => {
  const files = [file('example/SKILL.md'), file('example/scripts/run.ps1'), file('example/assets/template.docx')];
  const groups = groupSkillFolders(files);
  expect(groups).toHaveLength(1);
  const entries = await zipSkillFolder(groups[0].files);
  expect(entries.map(entry => entry.path)).toEqual(files.map(item => item.webkitRelativePath));
});

test('parent directory groups each immediate child without mixing files', async () => {
  const groups = groupSkillFolders([
    file('skills/first/SKILL.md'), file('skills/first/scripts/run.py'),
    file('skills/second/skill.md'), file('skills/second/manifest.json'),
    file('skills/second/assets/template.docx'), file('skills/.git/config')
  ]);
  expect(groups.map(group => group.name)).toEqual(['first', 'second']);
  const first = await zipSkillFolder(groups[0].files);
  const second = await zipSkillFolder(groups[1].files);
  expect(first.map(entry => entry.path)).toEqual(['first/SKILL.md', 'first/scripts/run.py']);
  expect(second.map(entry => entry.path)).toEqual(['second/skill.md', 'second/manifest.json', 'second/assets/template.docx']);
});

test('nested SKILL.md does not satisfy the skill root requirement', async () => {
  await expect(zipSkillFolder([file('bad/references/SKILL.md')])).rejects.toThrow('根目录必须包含 SKILL.md');
  expect(() => groupSkillFolders([file('empty/README.md')])).toThrow('未找到技能');
});

test('packaging and server errors are reported per item while later imports continue', async () => {
  const progress = jest.fn();
  const upload = jest.fn(async value => {
    if (value === 'duplicate') {
      const error = new Error('Conflict');
      error.response = { data: { message: '版本已存在' } };
      throw error;
    }
    return { skill: { name: value } };
  });
  const results = await importSkillBatch([
    { name: 'missing', prepare: () => zipSkillFolder([file('missing/README.md')]) },
    { name: 'duplicate.zip', prepare: async () => 'duplicate' },
    { name: 'good.zip', prepare: async () => 'good' }
  ], upload, progress);
  expect(results.map(item => item.success)).toEqual([false, false, true]);
  expect(results[1].error).toBe('版本已存在');
  expect(upload).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith({ completed: 3, total: 3, current: '' });
});
