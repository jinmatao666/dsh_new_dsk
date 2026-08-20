import React, { useMemo, useState } from 'react';
import {
  Modal,
  Form,
  Button,
  Space,
  Table,
  Tag,
  Radio,
  RadioGroup,
  Progress,
  Banner
} from '@douyinfe/semi-ui';
import { IconUpload } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../helpers';
import {
  categorySelectOptions,
  renderCategorySelectOption,
  renderCategorySelectedItem
} from './skillCategoryUtils';

// 与 SkillEditor.js 保持一致。文本附件按原文打包,二进制附件用 base64 fence。
const IMPORT_TEXT_EXTS = new Set([
  'md', 'txt', 'ts', 'js', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'json', 'yaml', 'yml', 'toml', 'css', 'html', 'htm', 'xml',
  'sql', 'go', 'rs', 'csv', 'tsv'
]);
const IMPORT_MAX_PER_SKILL = 5 * 1024 * 1024;  // 单个 skill 上限 5MB
// 噪音文件过滤(各系统元数据)
const NOISE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const NOISE_DIRS = new Set(['__MACOSX', '.git', 'node_modules', '__pycache__']);

const fenceLangForExt = (ext) => ({
  cjs: 'javascript',
  mjs: 'javascript',
  ps1: 'powershell',
  py: 'python',
  sh: 'bash',
  md: 'markdown',
  yml: 'yaml'
}[ext] || ext);

const readText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result || '');
    r.onerror = reject;
    r.readAsText(file);
  });

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const readBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytesToBase64(bytes);
};

// 将一批文件按"父文件夹下的子文件夹"分组
// 输入 files[i].webkitRelativePath 形如:
//   "1-通用类/pvs-docx/SKILL.md"
//   "1-通用类/pvs-docx/scripts/x.py"
// 返回 { parent: "1-通用类", groups: [{ name: "pvs-docx", files: [...] }, ...] }
const groupFilesBySkill = (files) => {
  const groups = new Map();
  let parent = '';
  for (const f of files) {
    const rel = f.webkitRelativePath || '';
    if (!rel) continue;
    const parts = rel.split('/');
    if (parts.length < 3) continue; // 至少要有 父/子/文件
    const [p, child, ...rest] = parts;
    parent = parent || p;
    // 过滤噪音目录(出现在路径任何位置都跳过)
    if (parts.some((s) => NOISE_DIRS.has(s))) continue;
    // 过滤噪音文件
    if (NOISE_NAMES.has(f.name)) continue;
    if (!groups.has(child)) groups.set(child, []);
    groups.get(child).push({ file: f, relInsideSkill: rest.join('/') });
  }
  return {
    parent,
    groups: Array.from(groups.entries()).map(([name, files]) => ({ name, files }))
  };
};

// 为单个 skill 打包 bundle + 提取 frontmatter name/description
const bundleOneSkill = async (skillName, entries) => {
  const skillMdEntry = entries.find(
    (e) => e.relInsideSkill.toLowerCase() === 'skill.md'
  );
  if (!skillMdEntry) {
    return { error: `${skillName}:缺少 SKILL.md,已跳过` };
  }
  const totalSize = entries.reduce((s, e) => s + (e.file.size || 0), 0);
  if (totalSize > IMPORT_MAX_PER_SKILL) {
    return { error: `${skillName}:文件夹总大小超过 5MB` };
  }

  let bundled = await readText(skillMdEntry.file);
  // 兼容 CRLF / CR 换行,frontmatter 正则只识别 LF
  const normalized = bundled.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 解析 frontmatter,提取 name/description
  let fmName = '';
  let fmDesc = '';
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const nameM = fmMatch[1].match(/^name:\s*(.+)$/m);
    const descM = fmMatch[1].match(/^description:\s*(.+)$/m);
    if (nameM) fmName = nameM[1].trim();
    if (descM) fmDesc = descM[1].trim();
  }

  for (const { file, relInsideSkill } of entries) {
    if (file === skillMdEntry.file) continue;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (IMPORT_TEXT_EXTS.has(ext)) {
      const content = await readText(file);
      bundled += `\n\n<!-- file: ${relInsideSkill} -->\n\`\`\`${fenceLangForExt(ext)}\n${content}\n\`\`\``;
    } else {
      const content = await readBase64(file);
      bundled += `\n\n<!-- file: ${relInsideSkill} -->\n\`\`\`base64\n${content}\n\`\`\``;
    }
  }

  return {
    name: fmName || skillName,
    description: fmDesc,
    content: bundled
  };
};

// 冲突处理策略
const STRATEGIES = {
  skip: '跳过',
  update: '更新覆盖',
  replace: '替换重建'
};

const BatchImportModal = ({ visible, onClose, onDone, skillCategories = [] }) => {
  const [parsed, setParsed] = useState(null); // { parent, groups: [...] }
  const [categoryIds, setCategoryIds] = useState([]);
  const [strategy, setStrategy] = useState('skip');
  const [progress, setProgress] = useState({ running: false, done: 0, total: 0 });
  const [report, setReport] = useState([]); // { name, status, message }

  const reset = () => {
    setParsed(null);
    setCategoryIds([]);
    setStrategy('skip');
    setProgress({ running: false, done: 0, total: 0 });
    setReport([]);
  };

  const handleClose = () => {
    if (progress.running) return; // 导入中禁止关闭
    reset();
    onClose();
  };

  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = ''; // 允许再次选同一个目录
    if (!files.length) return;
    const g = groupFilesBySkill(files);
    if (!g.groups.length) {
      showError('未识别到任何 skill 子文件夹(需形如 父文件夹/skill-name/SKILL.md)');
      return;
    }
    setParsed(g);
  };

  const saveSkillCategories = async (skillId) => {
    if (!categoryIds.length) {
      return;
    }
    if (!skillId) {
      throw new Error('未获取到 skill ID');
    }
    const res = await API.put(`/api/skill/${skillId}/categories`, {
      category_ids: categoryIds
    });
    if (res.data?.success === false) {
      throw new Error(res.data.message || '分类保存失败');
    }
  };

  const successResult = async (skill, status, message) => {
    const skillId = skill?.id;
    try {
      await saveSkillCategories(skillId);
    } catch (err) {
      return {
        status: 'failed',
        message: `${message}，但分类保存失败: ${err.message || '未知错误'}`
      };
    }
    return { status, message };
  };

  // 单个 skill 导入,返回 { status, message }
  const importOne = async (group) => {
    const bundle = await bundleOneSkill(group.name, group.files);
    if (bundle.error) return { status: 'skipped', message: bundle.error };

    const postBody = {
      name: bundle.name,
      description: bundle.description,
      submitter: '',
      version: '1.0',
      content: bundle.content
    };

    try {
      const res = await API.post('/api/skill/', postBody);
      if (res.data?.success === false) {
        return { status: 'failed', message: res.data?.message || '未知错误' };
      }
      return successResult(res.data?.data, 'created', '新建成功');
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data || {};
      // 非 409 → 彻底失败
      if (status !== 409) {
        return { status: 'failed', message: err.message || '请求失败' };
      }
      const existingId = body.existing_id;
      const existingDeleted = !!body.existing_is_deleted;

      if (strategy === 'skip') {
        return { status: 'skipped', message: `已存在(id=${existingId}),按策略跳过` };
      }
      if (strategy === 'update') {
        try {
          if (existingDeleted) {
            await API.post(`/api/skill/${existingId}/restore`);
          }
          const res2 = await API.put(`/api/skill/${existingId}`, postBody);
          if (res2.data?.success === false) {
            return { status: 'failed', message: res2.data?.message || '更新失败' };
          }
          return successResult(res2.data?.data || { id: existingId }, 'updated', `更新 id=${existingId}`);
        } catch (e) {
          return { status: 'failed', message: e.message || '更新失败' };
        }
      }
      // replace
      try {
        await API.delete(`/api/skill/${existingId}?force=1`);
        const res2 = await API.post('/api/skill/', postBody);
        if (res2.data?.success === false) {
          return { status: 'failed', message: res2.data?.message || '替换失败' };
        }
        return successResult(res2.data?.data, 'replaced', `替换原 id=${existingId}`);
      } catch (e) {
        return { status: 'failed', message: e.message || '替换失败' };
      }
    }
  };

  const handleRun = async () => {
    if (!parsed || !parsed.groups.length) return;
    const total = parsed.groups.length;
    setProgress({ running: true, done: 0, total });
    const out = [];
    for (let i = 0; i < total; i++) {
      const g = parsed.groups[i];
      // 串行,避免服务端压力 & 避免缓存刷新抖动
      // eslint-disable-next-line no-await-in-loop
      const r = await importOne(g);
      out.push({ name: g.name, ...r });
      setReport([...out]);
      setProgress({ running: true, done: i + 1, total });
    }
    setProgress({ running: false, done: total, total });
    const summary = out.reduce(
      (a, x) => {
        a[x.status] = (a[x.status] || 0) + 1;
        return a;
      },
      {}
    );
    const successN = (summary.created || 0) + (summary.updated || 0) + (summary.replaced || 0);
    showSuccess(
      `导入完成:成功 ${successN} / 跳过 ${summary.skipped || 0} / 失败 ${summary.failed || 0}`
    );
    if (typeof onDone === 'function') onDone();
  };

  const canRun = useMemo(
    () => parsed && parsed.groups.length > 0 && categoryIds.length > 0 && !progress.running,
    [parsed, categoryIds.length, progress.running]
  );

  const statusColor = (s) =>
    ({
      created: 'green',
      updated: 'blue',
      replaced: 'purple',
      skipped: 'grey',
      failed: 'red',
      pending: 'white'
    }[s] || 'white');

  const statusLabel = (s) =>
    ({
      created: '新建',
      updated: '更新',
      replaced: '替换',
      skipped: '跳过',
      failed: '失败',
      pending: '待处理'
    }[s] || s);

  // 表格数据:parsed.groups 为基础,report 覆盖同名行
  const reportByName = new Map(report.map((r) => [r.name, r]));
  const rows = parsed
    ? parsed.groups.map((g) => ({
        key: g.name,
        name: g.name,
        files: g.files.length,
        ...(reportByName.get(g.name) || { status: 'pending', message: '' })
      }))
    : [];

  return (
    <Modal
      title='批量导入 skill 文件夹'
      visible={visible}
      onCancel={handleClose}
      maskClosable={false}
      width={720}
      footer={
        <Space>
          <Button onClick={handleClose} disabled={progress.running}>
            {progress.done === progress.total && progress.total > 0 ? '关闭' : '取消'}
          </Button>
          <Button
            theme='solid'
            type='primary'
            disabled={!canRun}
            loading={progress.running}
            onClick={handleRun}
          >
            {progress.running
              ? `导入中 ${progress.done}/${progress.total}`
              : `开始导入 (${parsed?.groups.length || 0} 项)`}
          </Button>
        </Space>
      }
    >
      {!parsed ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <Banner
            fullMode={false}
            type='info'
            description='选择一个父文件夹,其中的每个子文件夹代表一个 skill(需包含 SKILL.md)。分类需要在下一步手动选择。'
            style={{ marginBottom: 16, textAlign: 'left' }}
          />
          <Button
            icon={<IconUpload />}
            theme='solid'
            type='primary'
            size='large'
            onClick={() => document.getElementById('batch-folder-input').click()}
          >
            选择父文件夹
          </Button>
          <input
            id='batch-folder-input'
            type='file'
            multiple
            style={{ display: 'none' }}
            onChange={handleFolderSelect}
            {...{ webkitdirectory: '', directory: '' }}
          />
        </div>
      ) : (
        <div>
          <Form labelPosition='left' labelWidth={80}>
            <Form.Select
              field='category_ids'
              label='分类'
              placeholder='选择分类'
              multiple
              initValue={categoryIds}
              optionList={categorySelectOptions(skillCategories)}
              renderOptionItem={renderCategorySelectOption}
              renderSelectedItem={renderCategorySelectedItem}
              onChange={(v) => setCategoryIds(v || [])}
              disabled={progress.running}
              style={{ width: '100%' }}
            />
            <Form.Slot label='冲突策略'>
              <RadioGroup
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                disabled={progress.running}
              >
                {Object.entries(STRATEGIES).map(([v, l]) => (
                  <Radio key={v} value={v}>
                    {l}
                  </Radio>
                ))}
              </RadioGroup>
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                跳过:保留原记录 ·
                更新覆盖:PUT 覆盖(保留 id 和 downloads,软删的会先恢复)·
                替换重建:物理删后新建(id 变更、downloads 归零)
              </div>
            </Form.Slot>
          </Form>

          {progress.total > 0 && (
            <div style={{ margin: '12px 0' }}>
              <Progress
                percent={Math.round((progress.done / progress.total) * 100)}
                showInfo
                stroke={progress.running ? '#007AFF' : '#34C759'}
              />
            </div>
          )}

          <Table
            size='small'
            pagination={false}
            dataSource={rows}
            columns={[
              { title: 'Skill 名', dataIndex: 'name', width: 220 },
              { title: '文件数', dataIndex: 'files', width: 80 },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (s) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>
              },
              {
                title: '说明',
                dataIndex: 'message',
                ellipsis: { showTitle: true }
              }
            ]}
            scroll={{ y: 260 }}
          />
        </div>
      )}
    </Modal>
  );
};

export default BatchImportModal;
