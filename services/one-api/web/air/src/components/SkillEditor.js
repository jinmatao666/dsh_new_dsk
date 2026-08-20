import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SideSheet,
  Form,
  Tabs,
  TabPane,
  Banner,
  Button,
  Space,
  Modal,
  Spin
} from '@douyinfe/semi-ui';
import { IconUpload } from '@douyinfe/semi-icons';
import Editor from '@monaco-editor/react';
import { API, showError, showSuccess } from '../helpers';
import {
  categorySelectOptions,
  renderCategorySelectOption,
  renderCategorySelectedItem
} from './skillCategoryUtils';

// 可导入的文本扩展名(保持与 Parvis 客户端一致)。其它附件用 base64 fence 打包。
const IMPORT_TEXT_EXTS = new Set([
  'md', 'txt', 'ts', 'js', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'json', 'yaml', 'yml', 'toml', 'css', 'html', 'htm', 'xml',
  'sql', 'go', 'rs', 'csv', 'tsv'
]);
const IMPORT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const NOISE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const NOISE_DIRS = new Set(['__macosx', '.git', 'node_modules', '__pycache__']);

const shouldSkipImportPath = (relPath) => {
  const parts = (relPath || '').split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const last = (parts[parts.length - 1] || '').toLowerCase();
  if (NOISE_NAMES.has(last)) return true;
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return NOISE_DIRS.has(lower) || lower.startsWith('.');
  });
};

const fenceLangForExt = (ext) => ({
  cjs: 'javascript',
  mjs: 'javascript',
  ps1: 'powershell',
  py: 'python',
  sh: 'bash',
  md: 'markdown',
  yml: 'yaml'
}[ext] || ext);

// splitContent — 前端复刻 model/skill_split.go 的行为,让文件夹导入后能立刻在
// body/assets Tab 看到拆分结果,而不是等保存提交后再由后端拆。
// 保持与后端完全一致:
//   识别两类 marker:  ^#{1,6}\s*Script:\s*<path>   或  ^<!--\s*file:\s*<path>\s*-->
//   每个 block 后紧跟一个 ``` 开始的 fence,以区域内"最后一个"独立 ``` 作为闭合
const splitContent = (content) => {
  if (!content) return { body: '', assets: '' };

  const scriptMarkerRe = /^(#{1,6})[ \t]*Script:[ \t]*(\S+)[ \t]*\r?\n/gm;
  const fileMarkerRe = /^<!--[ \t]*file:[ \t]*([^\n>]+?)[ \t]*-->[ \t]*\r?\n/gm;
  const markers = [];
  let m;
  scriptMarkerRe.lastIndex = 0;
  while ((m = scriptMarkerRe.exec(content)) !== null) {
    markers.push({ headerStart: m.index, afterHeader: m.index + m[0].length });
  }
  fileMarkerRe.lastIndex = 0;
  while ((m = fileMarkerRe.exec(content)) !== null) {
    markers.push({ headerStart: m.index, afterHeader: m.index + m[0].length });
  }
  markers.sort((a, b) => a.headerStart - b.headerStart);

  if (markers.length === 0) return { body: content, assets: '' };

  const fenceOpenRe = /^[ \t\r\n]*```[\w+-]*\r?\n/;
  const closeFenceRe = /^[ \t]*```[ \t]*\r?$/gm;

  let bodyStr = '';
  let assetsStr = '';
  let cursor = 0;
  let carved = 0;

  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i];
    const nextStart = i + 1 < markers.length ? markers[i + 1].headerStart : content.length;
    const spanAfterHeader = content.slice(mk.afterHeader, nextStart);

    const fenceMatch = spanAfterHeader.match(fenceOpenRe);
    if (!fenceMatch) continue;
    const codeStart = mk.afterHeader + fenceMatch[0].length;
    const codeRegion = content.slice(codeStart, nextStart);

    // 收集区域内所有 bare ```,用最后一个作为闭合(和后端一致)
    closeFenceRe.lastIndex = 0;
    let lastClose = null;
    let cm;
    while ((cm = closeFenceRe.exec(codeRegion)) !== null) {
      lastClose = { start: cm.index, end: cm.index + cm[0].length };
    }
    if (!lastClose) continue;

    const blockEnd = codeStart + lastClose.end;

    bodyStr += content.slice(cursor, mk.headerStart);

    if (carved > 0) assetsStr += '\n\n';
    assetsStr += content.slice(mk.headerStart, blockEnd).replace(/[\r\n]+$/, '');
    carved++;
    cursor = blockEnd;
  }

  bodyStr += content.slice(cursor);
  bodyStr = bodyStr.replace(/\n{3,}/g, '\n\n');
  bodyStr = bodyStr.replace(/[\r\n]+$/, '') + '\n';

  if (carved === 0) return { body: content, assets: '' };
  return { body: bodyStr, assets: assetsStr };
};

const EMPTY = {
  name: '',
  display_name: '',
  category: '',
  description: '',
  submitter: '',
  version: '1.0',
  tags: '',
  body: '',
  assets: '',
  content: '',
  owner: '',
  forked_from: '',
  category_ids: []
};

// 已跟踪的字段集合 — dirty 检测和 buildPutBody 共用
const TRACKED_KEYS = [
  'name', 'display_name', 'category', 'description', 'submitter', 'version',
  'tags', 'body', 'assets', 'content', 'forked_from',
  'category_ids'
];

// SkillEditor — view / edit / create skill via SideSheet + Monaco.
//
// Props:
//   visible         bool
//   kind            'public' | 'personal'
//   mode            'view' | 'edit' | 'create'
//   id              number | null   (null when mode='create')
//   onClose         () => void
//   onSaved         () => void      (parent reloads list)
//   skillCategories array           (公库分类候选,按 type_code 区分)
const SkillEditor = ({
  visible,
  kind,
  mode,
  id,
  onClose,
  onSaved,
  skillCategories = []
}) => {
  const readOnly = mode === 'view';
  const isCreate = mode === 'create';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(EMPTY);
  const [initialData, setInitialData] = useState(EMPTY);
  const [editorTab, setEditorTab] = useState('body');
  // 标志位:是否刚通过"从文件夹导入"加载 → 保存时 body/assets 不主动提交,让后端 SplitContent 拆
  const [importedFromFolder, setImportedFromFolder] = useState(false);
  const folderInputRef = useRef(null);
  // Semi UI Form 是 uncontrolled,initValue 只在首次渲染读取;
  // 文件夹导入后需要用 formApi.setValues 强制刷新表单显示
  const formApiRef = useRef(null);

  const detailUrl = useMemo(() => {
    if (isCreate || id == null) return null;
    return kind === 'public'
      ? `/api/skill/admin/${id}`
      : `/api/personal-skill/admin/${id}`;
  }, [kind, id, isCreate]);

  const writeBaseUrl = kind === 'public' ? '/api/skill' : '/api/personal-skill/admin';

  useEffect(() => {
    if (!visible) return;
    setImportedFromFolder(false);
    if (isCreate) {
      setData({ ...EMPTY });
      setInitialData({ ...EMPTY });
      setEditorTab('body');
      return;
    }
    if (!detailUrl) return;
    setLoading(true);
    API.get(detailUrl)
      .then((res) => {
        const payload = res.data && (res.data.data || res.data);
        if (!payload || res.data?.success === false) {
          showError(res.data?.message || '加载失败');
          onClose();
          return;
        }
        const tagsRaw = payload.tags;
        const normalized = {
          ...EMPTY,
          ...payload,
          tags:
            tagsRaw == null
              ? ''
              : typeof tagsRaw === 'string'
              ? tagsRaw
              : JSON.stringify(tagsRaw),
          body: payload.body || '',
          assets: payload.assets || '',
          content: payload.content || '',
          category_ids: (payload.categories || []).map((c) => c.id)
        };
        setData(normalized);
        setInitialData(normalized);
        setEditorTab('body');
      })
      .catch((err) => {
        showError(err.message || '加载失败');
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, detailUrl, isCreate]);

  const dirty = useMemo(() => {
    return TRACKED_KEYS.some((k) => (data[k] ?? '') !== (initialData[k] ?? ''));
  }, [data, initialData]);

  const handleClose = () => {
    if (dirty && !readOnly) {
      Modal.confirm({
        title: '确认丢弃修改?',
        content: '当前编辑器有未保存的修改。',
        onOk: () => onClose()
      });
      return;
    }
    onClose();
  };

  const buildPutBody = () => {
    const body = {};
    TRACKED_KEYS.forEach((k) => {
      if ((data[k] ?? '') !== (initialData[k] ?? '')) {
        if (k === 'tags') {
          try {
            body.tags = JSON.parse(data.tags || 'null');
          } catch {
            body.tags = data.tags;
          }
        } else {
          body[k] = data[k];
        }
      }
    });
    return body;
  };

  const buildPostBody = () => {
    // body / assets 始终提交:文件夹导入时已在前端用 splitContent 拆出,
    // 用户也可在 Tab 中手动调整,以表单实际值为准。后端 SplitContent 只在
    // body/assets 都缺时才触发,我们已提交则不会重拆。
    const body = {
      name: data.name,
      display_name: data.display_name,
      category: data.category,
      description: data.description,
      submitter: data.submitter,
      version: data.version,
      content: data.content,
      body: data.body,
      assets: data.assets
    };
    try {
      if (data.tags) body.tags = JSON.parse(data.tags);
    } catch {
      body.tags = data.tags;
    }
    if (kind === 'personal') {
      body.forked_from = data.forked_from;
    }
    return body;
  };

  const saveSkillCategories = async (skillId) => {
    if (kind !== 'public' || !skillId) return;
    const res = await API.put(`/api/skill/${skillId}/categories`, {
      category_ids: data.category_ids || []
    });
    if (res.data?.success === false) {
      throw new Error(res.data.message || '分类保存失败');
    }
  };

  // 公库:重名 409 弹窗 — 更新 / 替换 / 取消
  const handleConflict = (existingId, existingIsDeleted) => {
    let modalRef;
    const close = () => modalRef && modalRef.destroy();
    modalRef = Modal.info({
      title: '名称已被占用',
      content: `已存在 skill "${data.name}" (id=${existingId}, ${
        existingIsDeleted ? '已删除' : '正常'
      })。请选择处理方式:`,
      footer: (
        <Space>
          <Button onClick={close}>取消</Button>
          <Button
            type='danger'
            onClick={async () => {
              close();
              try {
                // 物理删老的 + 创建新的(id 改变,downloads 归零)
                await API.delete(`/api/skill/${existingId}?force=1`);
                const res2 = await API.post('/api/skill/', buildPostBody());
                if (res2.data?.success === false) {
                  showError(res2.data?.message || '替换失败');
                  return;
                }
                await saveSkillCategories(res2.data?.data?.id);
                showSuccess('替换成功');
                onSaved();
                onClose();
              } catch (e) {
                showError(e.message || '替换失败');
              }
            }}
          >
            替换
          </Button>
          <Button
            theme='solid'
            type='primary'
            onClick={async () => {
              close();
              try {
                // 已删除则先恢复,再 PUT 覆盖(id 不变,downloads 保留)
                if (existingIsDeleted) {
                  await API.post(`/api/skill/${existingId}/restore`);
                }
                // 用全字段 PUT(因为 id 不同,initialData diff 不可靠)
                const fullBody = buildPostBody();
                const res2 = await API.put(`/api/skill/${existingId}`, fullBody);
                if (res2.data?.success === false) {
                  showError(res2.data?.message || '更新失败');
                  return;
                }
                await saveSkillCategories(existingId);
                showSuccess('更新成功');
                onSaved();
                onClose();
              } catch (e) {
                showError(e.message || '更新失败');
              }
            }}
          >
            更新
          </Button>
        </Space>
      )
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let res;
      if (isCreate) {
        const url = kind === 'public' ? '/api/skill/' : '/api/personal-skill/';
        res = await API.post(url, buildPostBody());
      } else {
        res = await API.put(`${writeBaseUrl}/${id}`, buildPutBody());
      }
      const ok = res.data?.success !== false;
      if (!ok) {
        showError(res.data?.message || '保存失败');
        return;
      }
      const savedId = isCreate ? res.data?.data?.id : id;
      await saveSkillCategories(savedId);
      showSuccess('保存成功');
      onSaved();
      onClose();
    } catch (err) {
      // 公库 409 重名冲突
      if (kind === 'public' && err.response?.status === 409) {
        const body = err.response.data || {};
        handleConflict(body.existing_id, !!body.existing_is_deleted);
        return;
      }
      showError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onFormChange = (field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  // 浏览器端打包 SKILL 文件夹 → 写入 content → 保存后由后端 SplitContent 拆出 body/assets
  // 复用 Parvis 客户端 dialog-skills-plaza.tsx 的 bundling 约定
  const readFileText = (file) =>
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

  const readFileBase64 = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytesToBase64(bytes);
  };

  const handleFolderImport = async (e) => {
    const files = Array.from(e.target.files || []);
    // 让同一个文件夹能再次选中触发 change
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (!files.length) return;

    // 定位 SKILL.md(大小写不敏感,文件夹第二层)
    const skillMd = files.find((f) =>
      (f.webkitRelativePath || '').toLowerCase().endsWith('/skill.md')
    );
    if (!skillMd) {
      showError('文件夹中未找到 SKILL.md');
      return;
    }

    const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
    if (totalSize > IMPORT_MAX_SIZE) {
      showError('文件夹总大小不能超过 5MB');
      return;
    }

    try {
      let bundled = await readFileText(skillMd);
      // 兼容 CRLF / 老 Mac 的 CR 换行,frontmatter 解析需要统一成 LF
      const normalized = bundled.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 解析 frontmatter,提取 name / description
      let fmName = '';
      let fmDesc = '';
      const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const nameM = fmMatch[1].match(/^name:\s*(.+)$/m);
        const descM = fmMatch[1].match(/^description:\s*(.+)$/m);
        if (nameM) fmName = nameM[1].trim();
        if (descM) fmDesc = descM[1].trim();
      }
      // 文件夹名兜底当 name(SKILL.md frontmatter 缺 name 时)
      if (!fmName) {
        const folderName = (skillMd.webkitRelativePath || '').split('/')[0] || '';
        if (folderName) fmName = folderName;
      }

      // 附加其它文件:文本按原文,docx 等二进制按 base64。
      for (const f of files) {
        if (f === skillMd) continue;
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/');
        if (shouldSkipImportPath(rel || f.name)) continue;
        if (IMPORT_TEXT_EXTS.has(ext)) {
          const content = await readFileText(f);
          bundled += `\n\n<!-- file: ${rel} -->\n\`\`\`${fenceLangForExt(ext)}\n${content}\n\`\`\``;
        } else {
          const content = await readFileBase64(f);
          bundled += `\n\n<!-- file: ${rel} -->\n\`\`\`base64\n${content}\n\`\`\``;
        }
      }

      // 计算最终要写入的字段值:name / description 仅在用户当前没填时才被覆盖
      const nextName = data.name || fmName;
      const nextDesc = data.description || fmDesc;

      // 前端复刻后端 SplitContent:立刻拆出 body / assets,让用户在 Tab 里看到结果
      const { body: nextBody, assets: nextAssets } = splitContent(bundled);

      // 1) 更新内部 state(buildPostBody / dirty 检测依赖)
      setData((prev) => ({
        ...prev,
        name: nextName,
        description: nextDesc,
        content: bundled,
        body: nextBody,
        assets: nextAssets
      }));
      // 2) Semi Form 是 uncontrolled,必须显式 setValues 才能让输入框立刻显示新值
      if (formApiRef.current) {
        formApiRef.current.setValues(
          { name: nextName, description: nextDesc },
          { isOverride: false }
        );
      }
      // body/assets 是 Monaco 受控的,setData 之后它们会自动刷新;不需要额外操作
      setImportedFromFolder(true);
      setEditorTab('body');
      showSuccess('已导入:name/description/body/assets 均已自动填充');
    } catch (err) {
      showError(err.message || '读取文件失败');
    }
  };

  const titlePrefix = readOnly ? '查看' : isCreate ? '新建' : '编辑';
  const kindLabel = kind === 'public' ? '公库' : '私库';
  const sheetTitle = `${titlePrefix} ${kindLabel} skill${data.name ? ': ' + data.name : ''}`;

  const editorLanguage = editorTab === 'assets' ? 'json' : 'markdown';
  const editorValue = data[editorTab] || '';

  return (
    <SideSheet
      visible={visible}
      onCancel={handleClose}
      width='70%'
      title={sheetTitle}
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={handleClose}>取消</Button>
          {!readOnly && (
            <Button
              theme='solid'
              type='primary'
              loading={saving}
              disabled={!dirty && !isCreate}
              onClick={handleSave}
            >
              保存
            </Button>
          )}
        </Space>
      }
    >
      {loading ? (
        <Spin />
      ) : (
        <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
          <div style={{ width: 360, paddingRight: 16, overflowY: 'auto' }}>
            <Form
              labelPosition='top'
              allowEmpty
              getFormApi={(api) => {
                formApiRef.current = api;
              }}
            >
              <Form.Input
                field='name'
                label='Name'
                placeholder='填写 skill 的英文标识名（唯一）'
                disabled={readOnly}
                initValue={data.name}
                onChange={(v) => onFormChange('name', v)}
              />
              <Form.Input
                field='display_name'
                label='中文名称'
                placeholder='填写 skill 的中文显示名称'
                disabled={readOnly}
                initValue={data.display_name}
                onChange={(v) => onFormChange('display_name', v)}
              />
              {kind === 'public' && (
                <>
                  <Form.Select
                    field='category_ids'
                    label='分类'
                    placeholder='选择分类'
                    disabled={readOnly}
                    multiple
                    initValue={data.category_ids}
                    optionList={categorySelectOptions(skillCategories)}
                    renderOptionItem={renderCategorySelectOption}
                    renderSelectedItem={renderCategorySelectedItem}
                    onChange={(v) => onFormChange('category_ids', v || [])}
                    style={{ width: '100%' }}
                  />
                </>
              )}
              <Form.TextArea
                field='description'
                label='描述'
                rows={5}
                placeholder='填写 skill 的功能描述'
                disabled={readOnly}
                initValue={data.description}
                onChange={(v) => onFormChange('description', v)}
              />
              <Form.Input
                field='submitter'
                label='Submitter'
                placeholder='填写提交者名称'
                disabled={readOnly}
                initValue={data.submitter}
                onChange={(v) => onFormChange('submitter', v)}
              />
              <Form.Input
                field='version'
                label='Version'
                placeholder='如 1.0'
                disabled={readOnly}
                initValue={data.version}
                onChange={(v) => onFormChange('version', v)}
              />
              <Form.TextArea
                field='tags'
                label='Tags (JSON 数组)'
                rows={2}
                disabled={readOnly}
                initValue={data.tags}
                onChange={(v) => onFormChange('tags', v)}
                placeholder='["a","b"]'
              />
              {kind === 'personal' && (
                <>
                  <Form.Input
                    field='owner'
                    label='Owner'
                    disabled
                    initValue={data.owner}
                  />
                  <Form.Input
                    field='forked_from'
                    label='Forked From'
                    placeholder='填写来源 skill 标识（可选）'
                    disabled={readOnly}
                    initValue={data.forked_from}
                    onChange={(v) => onFormChange('forked_from', v)}
                  />
                </>
              )}
            </Form>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--semi-color-border)',
              paddingLeft: 16
            }}
          >
            <Tabs
              activeKey={editorTab}
              onChange={setEditorTab}
              type='card'
              size='small'
            >
              <TabPane tab='body (markdown)' itemKey='body' />
              <TabPane tab='assets (json)' itemKey='assets' />
              <TabPane tab='content (legacy)' itemKey='content' />
            </Tabs>
            {/* 公库新建/编辑 + body 或 content 编辑时,提供"从文件夹导入" */}
            {kind === 'public' &&
              !readOnly &&
              (editorTab === 'body' || editorTab === 'content') && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    margin: '8px 0'
                  }}
                >
                  <Button
                    icon={<IconUpload />}
                    onClick={() => folderInputRef.current?.click()}
                    size='small'
                  >
                    从文件夹导入
                  </Button>
                  <input
                    ref={folderInputRef}
                    type='file'
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFolderImport}
                    {...{ webkitdirectory: '', directory: '' }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--semi-color-text-2)'
                    }}
                  >
                    选择 SKILL 文件夹,导入后立刻拆分填入 body / assets,可在对应 Tab 调整后保存
                  </span>
                  {importedFromFolder && (
                    <span style={{ fontSize: 12, color: '#52c41a' }}>
                      ✓ 已导入并拆分
                    </span>
                  )}
                </div>
              )}
            {editorTab === 'content' && (
              <Banner
                fullMode={false}
                type='warning'
                description='Legacy 字段。新提交请优先用 body + assets;若通过文件夹导入则使用此字段。'
                style={{ marginBottom: 8 }}
              />
            )}
            <div style={{ flex: 1 }}>
              <Editor
                key={editorTab}
                height='100%'
                language={editorLanguage}
                value={editorValue}
                onChange={(v) => onFormChange(editorTab, v ?? '')}
                options={{
                  readOnly,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  fontSize: 13,
                  scrollBeyondLastLine: false
                }}
              />
            </div>
          </div>
        </div>
      )}
    </SideSheet>
  );
};

export default SkillEditor;
