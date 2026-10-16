import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Tag, Space, Input, Select, DatePicker, Spin, Modal, Typography, Radio, InputNumber, TextArea, Switch, Banner } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../helpers';
import { ConfigPageLayout } from '../../components/ConfigPageLayout';
import useColumnConfig from '../../hooks/useColumnConfig';

// 展示形态（仅通知类有）。dismissible=切换时的默认可关闭值；blocking 仅 modal_block 为真。
const DISPLAY_MODES = [
  { value: 'modal_block', label: '全屏弹窗(阻断)', dismissible: false },
  { value: 'modal', label: '普通弹窗', dismissible: true },
  { value: 'banner', label: '横幅(超长自动滚动)', dismissible: true },
  { value: 'toast', label: 'toast 轻提示', dismissible: true },
];

const CATEGORY_OPTIONS = [
  { value: 'notification', label: '通知' },
  { value: 'inbox', label: '站内信' },
];

const PLATFORM_OPTIONS = [
  { value: 'web', label: '官网' },
  { value: 'desktop', label: '客户端' },
];

const emptyForm = {
  id: 0,
  category: 'notification',
  title: '',
  content: '',
  display_mode: 'modal',
  blocking: false,
  dismissible: true,
  audience: 'all',
  crowd_id: null,
  target_users: '',
  platforms: [],
  min_version: '',
  max_version: '',
  action: '',
  plane: 'A',
  pre_login: false,
  priority: 0,
  status: 'draft',
  start_at: null,
  end_at: null,
};

const serializeForm = (value) => JSON.stringify(value);

// 后端 platforms 存 JSON 字符串数组，前端用数组编辑：进表单时解析，提交时 stringify
const parsePlatforms = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
};

const NotificationManage = () => {
  const [list, setList] = useState([]);
  const [crowds, setCrowds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [originForm, setOriginForm] = useState(emptyForm);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const dirty = serializeForm(form) !== serializeForm(originForm);
  const timeMode = !form.start_at && !form.end_at ? 'unlimited' : 'range';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/notification/');
      if (res.data.success) setList(res.data.data || []);
      else showError(res.data.message);
    } catch (e) {
      showError('加载失败');
    }
    // 独立加载人群列表，失败不影响主列表
    try {
      const cr = await API.get('/api/user-crowd/?page=1&page_size=100');
      if (cr.data.success) setCrowds(cr.data.data || []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCategoryChange = (v) => {
    // 切到站内信:无形态、不阻断、只走常规平面 A。
    if (v === 'inbox') {
      setForm((prev) => ({ ...prev, category: v, display_mode: 'inbox_only', blocking: false, plane: 'A' }));
    } else {
      // 切回通知:若原来是站内信占位形态，给个默认弹窗。
      setForm((prev) => ({
        ...prev,
        category: v,
        display_mode: prev.display_mode === 'inbox_only' ? 'modal' : prev.display_mode,
      }));
    }
  };

  const handleDisplayModeChange = (v) => {
    // dismissible 是运营的选择，切换形态时给个合理默认，之后可自行改。
    const mode = DISPLAY_MODES.find((m) => m.value === v);
    setForm((prev) => ({
      ...prev,
      display_mode: v,
      blocking: v === 'modal_block',
      dismissible: mode ? mode.dismissible : prev.dismissible,
    }));
  };

  const handleTimeModeChange = (mode) => {
    if (mode === 'unlimited') {
      setForm((prev) => ({ ...prev, start_at: null, end_at: null }));
    } else {
      setForm((prev) => ({ ...prev, start_at: prev.start_at || new Date().toISOString() }));
    }
  };

  const openCreate = () => {
    const next = { ...emptyForm };
    setForm(next);
    setOriginForm(next);
    setShowEdit(true);
  };

  const openEdit = (record) => {
    const next = { ...record, platforms: parsePlatforms(record.platforms) };
    setForm(next);
    setOriginForm(next);
    setShowEdit(true);
  };

  const handleCancel = () => {
    setForm(originForm);
  };

  const buildPayload = () => {
    const { platforms, ...rest } = form;
    return {
      ...rest,
      // platforms 数组 → JSON 字符串（空数组存空串=全部平台）
      platforms: platforms && platforms.length ? JSON.stringify(platforms) : '',
    };
  };

  const handleSave = async () => {
    if (!form.title) {
      showError('标题不能为空');
      return;
    }
    if (!form.content) {
      showError('正文不能为空');
      return;
    }
    if (form.audience === 'crowd' && !form.crowd_id) {
      showError('定向人群时必须选择分群');
      return;
    }
    const payload = buildPayload();
    try {
      const res = form.id
        ? await API.put('/api/notification/', payload)
        : await API.post('/api/notification/', payload);
      if (res.data.success) {
        showSuccess(form.id ? '已更新' : '已创建');
        setShowEdit(false);
        load();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存失败');
    }
  };

  const handleDelete = (record) => {
    Modal.confirm({
      title: '删除通知',
      content: `确定删除「${record.title}」？`,
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/notification/${record.id}`);
          if (res.data.success) {
            showSuccess('已删除');
            load();
          } else {
            showError(res.data.message);
          }
        } catch (e) {
          showError('删除失败');
        }
      },
    });
  };

  const handlePublish = (record, status) => {
    const isPublish = status === 'published';
    Modal.confirm({
      title: isPublish ? '确认发布' : '确认下架',
      content: isPublish
        ? `发布后「${record.title}」将对用户生效，确认发布？`
        : `下架后「${record.title}」将停止对用户生效，确认下架？`,
      okText: isPublish ? '发布' : '下架',
      okType: isPublish ? 'primary' : 'danger',
      onOk: async () => {
        try {
          const res = await API.post(`/api/notification/${record.id}/publish?status=${status}`);
          if (res.data.success) {
            showSuccess('状态已更新');
            load();
          } else {
            showError(res.data.message);
          }
        } catch (e) {
          showError('更新失败');
        }
      },
    });
  };

  const columns = [
    { title: '标题', dataIndex: 'title', width: 200 },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      render: (v) => {
        const map = {
          notification: { color: 'blue', text: '通知' },
          inbox: { color: 'purple', text: '站内信' },
        };
        const c = map[v] || { color: 'grey', text: v };
        return <Tag color={c.color}>{c.text}</Tag>;
      },
    },
    {
      title: '展示形态',
      dataIndex: 'display_mode',
      width: 140,
      render: (v, record) =>
        record.category === 'inbox' ? '—' : (DISPLAY_MODES.find((m) => m.value === v) || {}).label || v,
    },
    {
      title: '定向',
      dataIndex: 'audience',
      width: 120,
      render: (v, record) => {
        if (v === 'all') return '全体';
        if (v === 'crowd') {
          const c = crowds.find((x) => x.id === record.crowd_id);
          return `人群: ${c ? c.name : record.crowd_id}`;
        }
        if (v === 'users') return '指定用户';
        return v;
      },
    },
    {
      title: '平面',
      dataIndex: 'plane',
      width: 80,
      render: (v) => (v === 'B' ? <Tag color="orange">广播B</Tag> : <Tag color="light-blue">A</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => {
        const map = {
          draft: { color: 'grey', text: '草稿' },
          published: { color: 'green', text: '已发布' },
          archived: { color: 'red', text: '已下架' },
        };
        const s = map[v] || { color: 'grey', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 220,
      render: (text, record) => (
        <Space>
          <Button size="small" theme="borderless" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" theme="borderless" type="danger" onClick={() => handleDelete(record)}>
            删除
          </Button>
          {record.status === 'published' ? (
            <Button size="small" theme="borderless" onClick={() => handlePublish(record, 'archived')}>
              下架
            </Button>
          ) : (
            <Button size="small" theme="borderless" onClick={() => handlePublish(record, 'published')}>
              发布
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'notification_table_visible_columns',
    columnMeta: [
      { key: 'title', label: '标题', always: true },
      { key: 'category', label: '分类' },
      { key: 'display_mode', label: '展示形态' },
      { key: 'audience', label: '定向' },
      { key: 'plane', label: '平面' },
      { key: 'status', label: '状态' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 };
  const labelStyle = { width: 120, flexShrink: 0, color: 'var(--semi-color-text-0)', fontSize: 14 };
  const fieldStyle = { flex: 1 };

  if (showEdit) {
    return (
      <ConfigPageLayout>
        <div className="config-page-topbar">
          <Button icon={<IconArrowLeft />} theme="borderless" type="tertiary" onClick={() => setShowEdit(false)}>
            返回
          </Button>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            {form.id ? '编辑通知' : '新建通知'}
          </Typography.Title>
        </div>

        <Spin spinning={loading}>
          <div style={{ maxWidth: 800 }}>
            {/* 分类 */}
            <div style={rowStyle}>
              <div style={labelStyle}>分类</div>
              <Select
                value={form.category}
                onChange={(v) => handleCategoryChange(v)}
                optionList={CATEGORY_OPTIONS}
                style={fieldStyle}
              />
            </div>

            {/* 标题 */}
            <div style={rowStyle}>
              <div style={labelStyle}>标题</div>
              <Input value={form.title} onChange={(v) => updateField('title', v)} placeholder="通知标题" style={fieldStyle} />
            </div>

            {/* 正文 */}
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={{ ...labelStyle, paddingTop: 6 }}>正文(Markdown)</div>
              <TextArea
                value={form.content}
                onChange={(v) => updateField('content', v)}
                autosize={{ minRows: 6, maxRows: 16 }}
                placeholder={'## 标题\n正文内容支持 Markdown...'}
                style={fieldStyle}
              />
            </div>

            {/* 展示形态 + 可关闭：仅通知类有；站内信无形态，进消息中心 */}
            {form.category === 'notification' && (
              <>
                <div style={rowStyle}>
                  <div style={labelStyle}>展示形态</div>
                  <Select
                    value={form.display_mode}
                    onChange={handleDisplayModeChange}
                    optionList={DISPLAY_MODES.map((m) => ({ value: m.value, label: m.label }))}
                    style={fieldStyle}
                  />
                </div>

                <div style={rowStyle}>
                  <div style={labelStyle}>可关闭</div>
                  <div style={fieldStyle}>
                    <Switch checked={form.dismissible} onChange={(v) => updateField('dismissible', v)} />
                    <span style={{ marginLeft: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                      {form.dismissible ? '显示关闭按钮，用户可关闭' : '无关闭按钮'}
                      {form.display_mode === 'modal_block' && !form.dismissible ? '（强制阻断，用户无法关闭）' : ''}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* 定向 */}
            <div style={rowStyle}>
              <div style={labelStyle}>定向范围</div>
              <Radio.Group
                value={form.audience}
                onChange={(e) => updateField('audience', e.target.value)}
                type="button"
                style={fieldStyle}
              >
                <Radio value="all">全体</Radio>
                <Radio value="crowd">按人群</Radio>
                <Radio value="users">指定用户</Radio>
              </Radio.Group>
            </div>

            {/* 登录前可见：仅全体通知可配。勾选后未登录用户(登录页)也能看到，走公开接口不定向 */}
            {form.audience === 'all' && form.category === 'notification' && (
              <div style={rowStyle}>
                <div style={labelStyle}>登录前可见</div>
                <div style={fieldStyle}>
                  <Switch checked={form.pre_login} onChange={(v) => updateField('pre_login', v)} />
                  <span style={{ marginLeft: 12, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                    {form.pre_login ? '未登录用户(登录页)也会看到' : '仅已登录用户可见'}
                  </span>
                </div>
              </div>
            )}

            {form.audience === 'crowd' && (
              <div style={rowStyle}>
                <div style={labelStyle}>选择分群</div>
                <Select
                  value={form.crowd_id}
                  onChange={(v) => updateField('crowd_id', v)}
                  placeholder="请选择用户分群"
                  optionList={crowds.map((c) => ({ value: c.id, label: c.name }))}
                  style={fieldStyle}
                  filter
                />
              </div>
            )}

            {form.audience === 'users' && (
              <div style={rowStyle}>
                <div style={labelStyle}>用户ID列表</div>
                <Input
                  value={form.target_users}
                  onChange={(v) => updateField('target_users', v)}
                  placeholder="JSON 数组，如 [1,2,3]"
                  style={fieldStyle}
                />
              </div>
            )}

            {/* 平台 */}
            <div style={rowStyle}>
              <div style={labelStyle}>适用平台</div>
              <Select
                multiple
                value={form.platforms}
                onChange={(v) => updateField('platforms', v)}
                placeholder="留空=全部平台"
                optionList={PLATFORM_OPTIONS}
                style={fieldStyle}
              />
            </div>

            {/* 版本区间 */}
            <div style={rowStyle}>
              <div style={labelStyle}>版本区间</div>
              <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Input value={form.min_version} onChange={(v) => updateField('min_version', v)} placeholder="最低版本 如 2.0.0" style={{ flex: 1 }} />
                <span style={{ color: 'var(--semi-color-text-2)' }}>至</span>
                <Input value={form.max_version} onChange={(v) => updateField('max_version', v)} placeholder="最高版本" style={{ flex: 1 }} />
              </div>
            </div>

            {/* 投递平面：仅通知类可选广播平面 B（站内信不走广播） */}
            {form.category === 'notification' && (
            <div style={rowStyle}>
              <div style={labelStyle}>投递平面</div>
              <div style={fieldStyle}>
                <Radio.Group value={form.plane} onChange={(e) => updateField('plane', e.target.value)} type="button">
                  <Radio value="A">A(常规)</Radio>
                  <Radio value="B">B(广播·抗停服)</Radio>
                </Radio.Group>
                {form.plane === 'B' && (
                  <Banner
                    type="warning"
                    description="广播平面不经 one-api，独立静态文件下发，即使后端停服也能触达。用于停服/维护的全屏公告。"
                    style={{ marginTop: 8 }}
                    closeIcon={null}
                  />
                )}
              </div>
            </div>
            )}

            {/* 优先级 */}
            <div style={rowStyle}>
              <div style={labelStyle}>优先级</div>
              <InputNumber value={form.priority} onChange={(v) => updateField('priority', v)} min={0} style={fieldStyle} />
            </div>

            {/* 生效时间 */}
            <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={{ ...labelStyle, paddingTop: 6 }}>生效时间</div>
              <div style={fieldStyle}>
                <Radio.Group value={timeMode} onChange={(e) => handleTimeModeChange(e.target.value)} type="button">
                  <Radio value="range">区间</Radio>
                  <Radio value="unlimited">不限时</Radio>
                </Radio.Group>
                {timeMode === 'range' && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DatePicker
                      value={form.start_at ? new Date(form.start_at) : null}
                      onChange={(date) => updateField('start_at', date ? date.toISOString() : null)}
                      type="dateTime"
                      placeholder="开始时间"
                      style={{ flex: 1 }}
                    />
                    <span style={{ color: 'var(--semi-color-text-2)' }}>至</span>
                    <DatePicker
                      value={form.end_at ? new Date(form.end_at) : null}
                      onChange={(date) => updateField('end_at', date ? date.toISOString() : null)}
                      type="dateTime"
                      placeholder="结束时间"
                      style={{ flex: 1 }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </Spin>

        <div className="config-page-footer" style={{ marginTop: 8 }}>
          <span className="config-page-footer-hint">{dirty ? '有未保存的修改' : '所有修改已保存'}</span>
          <div className="config-page-footer-actions">
            <Button type="tertiary" disabled={!dirty} onClick={handleCancel}>
              重置
            </Button>
            <Button theme="solid" onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </ConfigPageLayout>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button theme="solid" onClick={openCreate}>
          新建通知
        </Button>
        <div style={{ marginLeft: 'auto' }}>{columnConfigButton}</div>
      </div>
      <Table
        columns={visibleColumns}
        dataSource={list}
        loading={loading}
        rowKey="id"
        pagination={false}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
      />
    </div>
  );
};

export default NotificationManage;
