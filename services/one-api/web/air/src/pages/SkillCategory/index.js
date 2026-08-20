import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, SideSheet, Space, Table, Tag } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';
import {
  SKILL_CATEGORY_TYPE_LABELS,
  SKILL_CATEGORY_TYPES
} from '../../components/skillCategoryUtils';
import useColumnConfig from '../../hooks/useColumnConfig';

const EMPTY = {
  id: null,
  type_id: null,
  code: '',
  name: '',
  description: '',
  status: 1,
  sort_order: 0
};

const getEditorFormKey = (data) => (data.id ? `edit-${data.id}` : `create-${data.type_id || 'none'}`);

const SkillCategory = forwardRef(({ embedded = false, keyword = '' }, ref) => {
  const [types, setTypes] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localKeyword, setLocalKeyword] = useState('');
  const [editor, setEditor] = useState({ visible: false, data: EMPTY });
  const searchKeyword = embedded ? keyword : localKeyword;

  const typeOptions = useMemo(
    () =>
      types.map((type) => ({
        label: type.name || SKILL_CATEGORY_TYPE_LABELS[type.code] || type.code,
        value: type.id
      })),
    [types]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [typeRes, categoryRes] = await Promise.all([
        API.get('/api/skill-category/types', { params: { includeDisabled: 1 } }),
        API.get('/api/skill-category/', { params: { includeDisabled: 1 } })
      ]);
      if (typeRes.data?.success === false) {
        showError(typeRes.data.message || '加载分类类型失败');
        return;
      }
      if (categoryRes.data?.success === false) {
        showError(categoryRes.data.message || '加载分类失败');
        return;
      }
      setTypes(typeRes.data?.data || []);
      setItems(categoryRes.data?.data || []);
    } catch (err) {
      showError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useImperativeHandle(ref, () => ({
    openCreate,
    refresh: load
  }));

  const openCreate = (typeCode = SKILL_CATEGORY_TYPES.package) => {
    const defaultType = types.find((type) => type.code === typeCode) || types[0];
    setEditor({
      visible: true,
      data: {
        ...EMPTY,
        type_id: defaultType?.id || null
      }
    });
  };

  const openEdit = (row) => {
    setEditor({
      visible: true,
      data: {
        ...EMPTY,
        ...row
      }
    });
  };

  const closeEditor = () => setEditor({ visible: false, data: EMPTY });

  const updateEditor = (field, value) => {
    setEditor((prev) => ({
      ...prev,
      data: { ...prev.data, [field]: value }
    }));
  };

  const buildPayload = () => {
    const payload = {
      type_id: editor.data.type_id,
      code: editor.data.code,
      name: editor.data.name,
      description: editor.data.description,
      status: Number(editor.data.status),
      sort_order: Number(editor.data.sort_order || 0)
    };
    return payload;
  };

  const save = async () => {
    if (!editor.data.type_id || !editor.data.code || !editor.data.name) {
      showError('类型、code、名称必填');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      const res = editor.data.id
        ? await API.put(`/api/skill-category/${editor.data.id}`, payload)
        : await API.post('/api/skill-category/', payload);
      if (res.data?.success === false) {
        showError(res.data.message || '保存失败');
        return;
      }
      showSuccess('保存成功');
      closeEditor();
      load();
    } catch (err) {
      showError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) => {
    const skillCount = Number(row.skill_count || 0);
    if (skillCount > 0) {
      showError(`该分类下已绑定 ${skillCount} 个 skill，请先移除分类下的 skill 后再删除`);
      return;
    }
    Modal.confirm({
      title: `删除分类: ${row.name || row.code}?`,
      content: '分类会被软删除。',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await API.delete(`/api/skill-category/${row.id}`);
          if (res.data?.success === false) {
            showError(res.data.message || '删除失败');
            return;
          }
          showSuccess('已删除');
          load();
        } catch (err) {
          showError(err.message || '删除失败');
        }
      }
    });
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: 'Code', dataIndex: 'code', width: 180 },
    {
      title: '类型',
      dataIndex: 'type_code',
      width: 120,
      render: (v) => <Tag color={v === SKILL_CATEGORY_TYPES.package ? 'blue' : 'green'}>{SKILL_CATEGORY_TYPE_LABELS[v] || v}</Tag>
    },
    { title: '描述', dataIndex: 'description', ellipsis: { showTitle: true } },
    {
      title: 'Skill数量',
      dataIndex: 'skill_count',
      width: 100,
      render: (v) => Number(v || 0)
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => (Number(v) === 1 ? <Tag color='green'>启用</Tag> : <Tag color='red'>禁用</Tag>)
    },
    { title: '排序', dataIndex: 'sort_order', width: 80 },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 170,
      render: (v) => (v ? timestamp2string(v) : '-')
    },
    {
      title: '操作',
      width: 150,
      render: (_, row) => (
        <Space>
          <Button size='small' onClick={() => openEdit(row)}>编辑</Button>
          <Button size='small' type='danger' theme='light' onClick={() => remove(row)}>删除</Button>
        </Space>
      )
    }
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'skillcategory_table_visible_columns',
    columnMeta: [
      { key: 'id', label: 'ID', always: true },
      { key: 'name', label: '名称' },
      { key: 'code', label: 'Code' },
      { key: 'type_code', label: '类型' },
      { key: 'description', label: '描述' },
      { key: 'skill_count', label: 'Skill数量' },
      { key: 'status', label: '状态' },
      { key: 'sort_order', label: '排序' },
      { key: 'updated_at', label: '更新时间' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  const filteredItems = useMemo(() => {
    const term = (searchKeyword || '').trim().toLowerCase();
    if (!term) {
      return items;
    }
    return items.filter((item) =>
      [
        item.code,
        item.name,
        item.description,
        item.type_code,
        item.type_name,
        SKILL_CATEGORY_TYPE_LABELS[item.type_code]
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [items, searchKeyword]);

  return (
    <div style={{ padding: embedded ? 0 : 24, height: embedded ? '100%' : undefined, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!embedded && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Space>
          <Button icon={<IconPlus />} theme='solid' type='primary' onClick={() => openCreate()}>
            新建分类
          </Button>
          <Input
            prefix={<IconSearch />}
            placeholder='搜索 code / 名称 / 描述 / 类型'
            value={localKeyword}
            onChange={setLocalKeyword}
            style={{ width: 280 }}
            showClear
          />
          {columnConfigButton}
        </Space>
      </div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {embedded && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            {columnConfigButton}
          </div>
        )}
        <Table
          columns={visibleColumns}
          dataSource={filteredItems}
          rowKey='id'
          loading={loading}
          scroll={{ y: 'calc(100vh - 245px)' }}
          sticky={{ top: 0 }}
          pagination={{ pageSize: 20 }}
        />
      </div>

      <SideSheet
        title={`${editor.data.id ? '编辑' : '新建'}分类${editor.data.name ? ': ' + editor.data.name : ''}`}
        visible={editor.visible}
        onCancel={closeEditor}
        width={560}
        maskClosable={false}
        footer={
          <Space>
            <Button onClick={closeEditor}>取消</Button>
            <Button theme='solid' type='primary' loading={saving} onClick={save}>
              保存
            </Button>
          </Space>
        }
      >
        <div style={{ height: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: 8 }}>
          <Form key={getEditorFormKey(editor.data)} labelPosition='top' allowEmpty>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Form.Input field='name' label='名称' placeholder='请输入分类名称' initValue={editor.data.name} onChange={(v) => updateEditor('name', v)} />
              <Form.Input field='code' label='Code' placeholder='请输入分类编码' initValue={editor.data.code} onChange={(v) => updateEditor('code', v)} />
              <div style={{ gridColumn: '1 / -1' }}>
                <Form.TextArea field='description' label='描述' placeholder='请输入分类描述' rows={8} initValue={editor.data.description} onChange={(v) => updateEditor('description', v)} />
              </div>
              <Form.Select
                field='type_id'
                label='类型'
                placeholder='请选择分类类型'
                initValue={editor.data.type_id}
                optionList={typeOptions}
                onChange={(v) => updateEditor('type_id', v)}
                style={{ width: '100%' }}
              />
              <Form.Select
                field='status'
                label='状态'
                placeholder='请选择状态'
                initValue={editor.data.status}
                optionList={[
                  { label: '启用', value: 1 },
                  { label: '禁用', value: 0 }
                ]}
                onChange={(v) => updateEditor('status', v)}
                style={{ width: '100%' }}
              />
              <div style={{ gridColumn: '1 / -1' }}>
                <Form.InputNumber field='sort_order' label='排序' placeholder='请输入排序值' initValue={editor.data.sort_order} onChange={(v) => updateEditor('sort_order', v)} style={{ width: '100%' }} />
              </div>
            </div>
          </Form>
        </div>
      </SideSheet>
    </div>
  );
});

export default SkillCategory;
