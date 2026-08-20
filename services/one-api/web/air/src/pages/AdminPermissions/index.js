import React, { useContext, useEffect, useRef, useState } from 'react';
import { API, showError, showSuccess } from '../../helpers';
import { AutoComplete, Button, Checkbox, Modal, Select, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { UserPlus } from 'lucide-react';
import { UserContext } from '../../context/User';
import useColumnConfig from '../../hooks/useColumnConfig';

const { Text } = Typography;

const PERMISSION_GROUPS = [
  {
    label: '配置管理',
    items: [
      { key: 'channel', label: '渠道管理' },
      { key: 'skill', label: 'Skill 管理' },
      { key: 'model_config', label: '模型配置' },
    ],
  },
  {
    label: '账户管理',
    items: [
      { key: 'user', label: '用户管理' },
      { key: 'organization', label: '企业管理' },
    ],
  },
  {
    label: '交易中心',
    items: [
      { key: 'product', label: '商品管理' },
      { key: 'member_identity', label: '会员身份' },
      { key: 'order', label: '订单管理' },
    ],
  },
  {
    label: '运营工具',
    items: [
      { key: 'operation_dashboard', label: '运营看板' },
      { key: 'user_operation', label: '用户运营' },
      { key: 'activity', label: '活动管理' },
      { key: 'message_notification', label: '消息通知' },
      { key: 'version_note', label: '版本发布' },
    ],
  },
  {
    label: '数据看板',
    items: [
      { key: 'parvis_dashboard', label: 'Parvis看板' },
      { key: 'custom_board', label: '自定义看板' },
    ],
  },
  {
    label: '日志监控',
    items: [
      { key: 'monitor_board', label: '监控看板' },
      { key: 'log', label: '日志详情' },
      { key: 'admin_operation_log', label: '后台操作记录' },
      { key: 'feedback', label: '用户反馈' },
    ],
  },
  {
    label: '系统',
    items: [
      { key: 'system_setting', label: '系统设置' },
      { key: 'toolbox', label: '工具箱' },
      { key: 'admin_permissions', label: '后台权限管理' },
    ],
  },
];

const ALL_KEYS = PERMISSION_GROUPS.flatMap(g => g.items.map(i => i.key));

const parsePermissions = (raw) => {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
};

const AdminPermissions = () => {
  const [userState] = useContext(UserContext);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editPerms, setEditPerms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [roleChanging, setRoleChanging] = useState({});
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef(null);
  const justSelected = useRef(false);

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/admin-permissions/');
      const { success, data } = res.data;
      if (success) {
        setUsers(data || []);
      } else {
        showError('加载管理员列表失败');
      }
    } catch {
      showError('加载管理员列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAdmins(); }, []);

  const openEdit = (user) => {
    setEditUser(user);
    setEditPerms(parsePermissions(user.admin_permissions));
  };

  const closeEdit = () => { setEditUser(null); setEditPerms([]); };

  const togglePerm = (key) => {
    setEditPerms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const selectAll = () => setEditPerms([...ALL_KEYS]);
  const clearAll = () => setEditPerms([]);

  const savePerms = async () => {
    setSaving(true);
    try {
      const res = await API.put(`/api/admin-permissions/${editUser.id}`, {
        admin_permissions: JSON.stringify(editPerms),
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess('权限已保存');
        setUsers(prev => prev.map(u =>
          u.id === editUser.id ? { ...u, admin_permissions: JSON.stringify(editPerms) } : u
        ));
        closeEdit();
      } else {
        showError(message || '保存失败');
      }
    } catch {
      showError('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (userId, role) => {
    setRoleChanging(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await API.put(`/api/admin-permissions/${userId}/role`, { role });
      const { success, message } = res.data;
      if (success) {
        showSuccess('角色已更新');
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
      } else {
        showError(message || '更新失败');
      }
    } catch {
      showError('更新失败');
    } finally {
      setRoleChanging(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleSearch = (val) => {
    setSearchKeyword(val);
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    setSelectedUser(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await API.get(`/api/user/search?keyword=${encodeURIComponent(val)}`);
        const { success, data } = res.data;
        if (success) {
          const filtered = (data || []).filter(u => !users.find(e => e.id === u.id));
          setSearchResults(filtered.map(u => ({
            value: u.display_name ? `${u.username}（${u.display_name}）` : u.username,
            label: u.display_name ? `${u.username}（${u.display_name}）` : u.username,
            user: u,
          })));
        }
      } catch { /* ignore */ }
    }, 300);
  };

  const handleSelect = (val) => {
    const found = searchResults.find(r => r.value === val);
    if (found?.user) {
      justSelected.current = true;
      setSelectedUser(found.user);
      setSearchKeyword(val);
    }
  };

  const handleAddUser = async () => {
    if (!selectedUser) return;
    if (users.find(e => e.id === selectedUser.id)) { showError('该账号已在列表中'); return; }
    setAdding(true);
    try {
      const res = await API.put(`/api/admin-permissions/${selectedUser.id}/role`, { role: 10 });
      const { success, message } = res.data;
      if (success) {
        showSuccess(`已将 ${selectedUser.username} 设为管理员`);
        setUsers(prev => [...prev, { ...selectedUser, role: 10, admin_permissions: '[]' }]);
        setSearchKeyword('');
        setSearchResults([]);
        setSelectedUser(null);
      } else {
        showError(message || '添加失败');
      }
    } catch {
      showError('添加失败');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveUser = async (userId) => {
    setRoleChanging(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await API.put(`/api/admin-permissions/${userId}/role`, { role: 1 });
      const { success, message } = res.data;
      if (success) {
        showSuccess('已移除管理员权限');
        setUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        showError(message || '移除失败');
      }
    } catch {
      showError('移除失败');
    } finally {
      setRoleChanging(prev => ({ ...prev, [userId]: false }));
    }
  };

  const renderPermTags = (raw, row) => {
    if (row.role === 100) return <Tag color="purple" size="small">超管·全部权限</Tag>;
    const perms = parsePermissions(raw);
    if (!perms.length) return <Text type="tertiary" size="small">无权限</Text>;
    const labels = PERMISSION_GROUPS.flatMap(g => g.items).filter(i => perms.includes(i.key)).map(i => i.label);
    if (labels.length === ALL_KEYS.length) return <Tag color="green" size="small">全部权限</Tag>;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {labels.slice(0, 4).map(l => <Tag key={l} size="small" color="blue">{l}</Tag>)}
        {labels.length > 4 && <Tag size="small" color="grey">+{labels.length - 4}</Tag>}
      </div>
    );
  };

  const columns = [
    {
      title: '账号',
      dataIndex: 'username',
      render: (text, row) => (
        <div>
          <Text strong>{text}</Text>
          {row.display_name && <Text type="tertiary" size="small" style={{ display: 'block' }}>{row.display_name}</Text>}
        </div>
      ),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      render: text => <Text type="secondary" size="small">{text || '—'}</Text>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      width: 140,
      render: (role, row) => {
        const isSelf = userState?.user?.id === row.id;
        return (
          <Select
            value={role}
            size="small"
            disabled={isSelf || roleChanging[row.id]}
            style={{ width: 120 }}
            onChange={val => changeRole(row.id, val)}
          >
            <Select.Option value={10}>管理员</Select.Option>
            <Select.Option value={100}>超管</Select.Option>
          </Select>
        );
      },
    },
    {
      title: '功能权限',
      dataIndex: 'admin_permissions',
      render: (raw, row) => renderPermTags(raw, row),
    },
    {
      title: '操作',
      width: 130,
      render: (_, row) => {
        const isSelf = userState?.user?.id === row.id;
        if (isSelf) return null;
        return (
          <div style={{ display: 'flex', gap: 4 }}>
            {row.role !== 100 && (
              <Button size="small" type="tertiary" onClick={() => openEdit(row)}>编辑权限</Button>
            )}
            <Button
              size="small"
              type="danger"
              theme="borderless"
              disabled={roleChanging[row.id]}
              onClick={() => handleRemoveUser(row.id)}
            >移除</Button>
          </div>
        );
      },
    },
  ];

  const { visibleColumns, columnConfigButton } = useColumnConfig({
    storageKey: 'admin_permissions_table_visible_columns',
    columnMeta: [
      { key: 'username', label: '账号', always: true },
      { key: 'email', label: '邮箱' },
      { key: 'role', label: '角色' },
      { key: 'admin_permissions', label: '功能权限' },
    ],
    allColumns: columns,
    buttonProps: { theme: 'light', type: 'tertiary', children: '列配置' },
  });

  return (
    <div style={{ padding: '24px 0' }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <UserPlus size={16} strokeWidth={1.75} style={{ color: 'var(--semi-color-primary)', flexShrink: 0 }} />
        <AutoComplete
          data={searchResults}
          value={searchKeyword}
          onChange={handleSearch}
          onSelect={handleSelect}
          placeholder="输入账号名搜索"
          style={{ width: 280 }}
          size="small"
          emptyContent={searchKeyword && !justSelected.current
            ? <Text type="tertiary" size="small" style={{ padding: '8px 12px', display: 'block' }}>无匹配账号</Text>
            : null}
          renderItem={item => <Text size="small">{item.label}</Text>}
        />
        <Button
          size="small"
          type="primary"
          loading={adding}
          disabled={!selectedUser}
          onClick={handleAddUser}
        >添加为管理员</Button>
        <div style={{ marginLeft: 'auto' }}>{columnConfigButton}</div>
      </div>

      <Spin spinning={loading}>
        <Table
          columns={visibleColumns}
          dataSource={users}
          rowKey="id"
          size="small"
          pagination={false}
          empty={<Text type="tertiary">暂无管理员账号</Text>}
        />
      </Spin>

      <Modal
        title={`编辑权限：${editUser?.display_name || editUser?.username || ''}`}
        visible={!!editUser}
        onCancel={closeEdit}
        onOk={savePerms}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={520}
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <Button size="small" type="tertiary" onClick={selectAll}>全选</Button>
          <Button size="small" type="tertiary" onClick={clearAll}>清空</Button>
          <Text type="tertiary" size="small" style={{ marginLeft: 'auto', lineHeight: '28px' }}>
            已选 {editPerms.length} / {ALL_KEYS.length}
          </Text>
        </div>

        {PERMISSION_GROUPS.map(group => {
          const groupKeys = group.items.map(i => i.key);
          const checkedCount = groupKeys.filter(k => editPerms.includes(k)).length;
          const allChecked = checkedCount === groupKeys.length;
          const indeterminate = checkedCount > 0 && !allChecked;
          const toggleGroup = () => {
            if (allChecked) {
              setEditPerms(prev => prev.filter(k => !groupKeys.includes(k)));
            } else {
              setEditPerms(prev => [...new Set([...prev, ...groupKeys])]);
            }
          };
          return (
            <div key={group.label} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Checkbox checked={allChecked} indeterminate={indeterminate} onChange={toggleGroup} />
                <Text
                  type="tertiary"
                  size="small"
                  strong
                  style={{ textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}
                  onClick={toggleGroup}
                >
                  {group.label}
                </Text>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 0', paddingLeft: 24 }}>
                {group.items.map(item => (
                  <Checkbox
                    key={item.key}
                    checked={editPerms.includes(item.key)}
                    onChange={() => togglePerm(item.key)}
                  >
                    <Text size="small">{item.label}</Text>
                  </Checkbox>
                ))}
              </div>
            </div>
          );
        })}
      </Modal>
    </div>
  );
};

export default AdminPermissions;
