import React, { useEffect, useState, useCallback } from 'react';
import { Button, Table, Modal, Input, InputNumber, Tooltip, Typography, Space } from '@douyinfe/semi-ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { API, showError, showSuccess } from '../../helpers';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Text } = Typography;

const COLUMN_META = [
  { key: 'name', label: '名称', always: true },
  { key: 'description', label: '描述' },
  { key: 'package_level', label: '等级' },
  { key: 'bound_packages', label: '已绑定商品' },
];

const emptyForm = { id: 0, name: '', description: '', package_level: 1, enabled: true };

const MemberIdentityConfig = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idRes = await API.get('/api/member-identity/');
      if (idRes.data.success) setList(idRes.data.data || []);
    } catch (e) {
      showError('加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(emptyForm); setModalVisible(true); };
  const openEdit = (record) => { setForm({ ...record }); setModalVisible(true); };

  const handleSave = async () => {
    if (!form.name) { showError('名称不能为空'); return; }
    setSaving(true);
    try {
      const res = form.id
        ? await API.put('/api/member-identity/', form)
        : await API.post('/api/member-identity/', form);
      if (res.data.success) {
        showSuccess(form.id ? '已更新' : '已创建');
        setModalVisible(false);
        load();
      } else {
        showError(res.data.message);
      }
    } catch (e) {
      showError('保存失败');
    }
    setSaving(false);
  };

  const handleDelete = (record) => {
    const bound = record.bound_packages || [];
    if (bound.length > 0) {
      Modal.warning({
        title: '无法删除',
        content: `「${record.name}」已绑定商品：${bound.join('、')}，请先在商品中解除关联后再删除。`,
      });
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: '删除后已配置该身份的活动/批量发放将无法使用，请确认。',
      onOk: async () => {
        const res = await API.delete(`/api/member-identity/${record.id}`);
        if (res.data.success) { showSuccess('已删除'); load(); }
        else showError(res.data.message);
      },
    });
  };

  const columns = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', render: (v) => v || '-' },
    { title: '等级', dataIndex: 'package_level', width: 100, align: 'center' },
    {
      title: '已绑定商品',
      dataIndex: 'bound_packages',
      render: (v) => (v && v.length > 0 ? v.join('、') : '-'),
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => {
        const isBound = (record.bound_packages || []).length > 0;
        return (
          <Space>
            <Button size="small" icon={<Pencil size={14} />} onClick={() => openEdit(record)} />
            {isBound ? (
              <Tooltip content="已绑定商品身份不可删除">
                <span style={{ display: 'inline-flex' }}>
                  <Button size="small" type="danger" icon={<Trash2 size={14} />} disabled />
                </span>
              </Tooltip>
            ) : (
              <Button
                size="small"
                type="danger"
                icon={<Trash2 size={14} />}
                onClick={() => handleDelete(record)}
              />
            )}
          </Space>
        );
      },
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'memberidentityconfig_table_visible_columns',
    columnMeta: COLUMN_META,
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Button icon={<Plus size={16} />} theme="solid" onClick={openCreate}>新增身份</Button>
        {columnConfigButton}
      </div>
      <Table columns={visibleColumns} dataSource={list} loading={loading} rowKey="id" pagination={false} />

      <Modal
        title={form.id ? '编辑会员身份' : '新增会员身份'}
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={440}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          <div>
            <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>名称</Text>
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="如：Pro会员、企业版" />
          </div>
          <div>
            <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>描述（可选）</Text>
            <Input value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="简短说明" />
          </div>
          <div>
            <Text style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>等级</Text>
            <InputNumber
              value={form.package_level}
              onChange={(v) => setForm({ ...form, package_level: v })}
              min={0}
              style={{ width: 120 }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MemberIdentityConfig;
