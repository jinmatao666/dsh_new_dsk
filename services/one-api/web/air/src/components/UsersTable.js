import React, { useEffect, useState } from 'react';
import { API, showError, showSuccess } from '../helpers';
import { Button, Input, Modal, Table, Tag, Tooltip, Dropdown, Typography } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { renderGroup, renderNumber, renderQuota } from '../helpers/render';
import useColumnConfig from '../hooks/useColumnConfig';
import AddUser from '../pages/User/AddUser';
import EditUser from '../pages/User/EditUser';
import UserTokensSubTable from './UserTokensSubTable';
import UserActivityModal from './UserActivityModal';

function renderRole(role) {
  switch (role) {
    case 1:
      return <Tag size="large">普通用户</Tag>;
    case 10:
      return <Tag color="yellow" size="large">管理员</Tag>;
    case 100:
      return <Tag color="orange" size="large">超级管理员</Tag>;
    default:
      return <Tag color="red" size="large">未知身份</Tag>;
  }
}

function renderAccountType(record) {
  if (record.account_type === 2) {
    return (
      <Tooltip content={record.org_id ? `所属企业 ID: ${record.org_id}` : '企业账户'}>
        <Tag color="violet" size="large">企业</Tag>
      </Tooltip>
    );
  }
  return <Tag color="grey" size="large">个体</Tag>;
}

const COLUMN_META = [
  { key: 'account_id', label: 'ID', always: true },
  { key: 'username', label: '用户名' },
  { key: 'group', label: '分组' },
  { key: 'account_type', label: '账户类型' },
  { key: 'quota', label: '剩余额度' },
  { key: 'used_quota', label: '已用额度' },
  { key: 'request_count', label: '调用次数' },
  { key: 'role', label: '角色' },
  { key: 'status', label: '状态' },
  { key: 'tags', label: '标签' },
  { key: 'operate', label: '操作', always: true },
];

const COLUMN_STORAGE_KEY = 'users_table_visible_columns';

const UsersTable = () => {
  const allColumns = [{
    title: 'ID', dataIndex: 'account_id', width: 200, align: 'center', render: (accountId, record) => {
      // 后台用户 ID 统一以账号中心 account_id 为准;未迁移(account_id 为空)回退本地 id 并标记。
      if (accountId) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
            <Typography.Text style={{ fontSize: 13 }}>{accountId}</Typography.Text>
            <Typography.Text type="tertiary" size="small">#{record.id}</Typography.Text>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.3 }}>
          <Typography.Text style={{ fontSize: 13 }}>#{record.id}</Typography.Text>
          <Typography.Text type="tertiary" size="small">未迁移</Typography.Text>
        </div>
      );
    }
  }, {
    title: '用户名', dataIndex: 'username', width: 180, align: 'center'
  }, {
    title: '分组', dataIndex: 'group', width: 100, align: 'center', render: (text, record, index) => {
      return (<div style={{ display: 'flex', justifyContent: 'center' }}>
        {renderGroup(text)}
      </div>);
    }
  }, {
    title: '账户类型', dataIndex: 'account_type', width: 90, align: 'center', render: (_, record) => renderAccountType(record)
  }, {
    title: '剩余额度', dataIndex: 'quota', width: 120, align: 'center', render: (text, record) => {
      const isEnterprise = record.account_type === 2;
      const subQuota = record.subscription_quota ?? 0;
      const timedQuota = record.timed_quota_total ?? 0;
      // 真实余额以 subscription_quota + timed_quota_total 为准,镜像列 quota 可能与账本漂移
      const totalQuota = subQuota + timedQuota;
      return (
        <Tooltip content={isEnterprise ? '企业账户不持有个人积分' : (
          <div>
            <div>剩余额度: {renderQuota(totalQuota)}</div>
            <div>订阅积分: {renderQuota(subQuota)}</div>
            <div>定时积分: {renderQuota(timedQuota)}</div>
          </div>
        )}>
          <Tag color="white" size="large">{isEnterprise ? '—' : renderQuota(totalQuota)}</Tag>
        </Tooltip>
      );
    }
  }, {
    title: '已用额度', dataIndex: 'used_quota', width: 120, align: 'center', render: (text, record) => (
      <Tag color="white" size="large">{renderQuota(record.used_quota)}</Tag>
    )
  }, {
    title: '调用次数', dataIndex: 'request_count', width: 100, align: 'center', render: (text, record) => (
      <Tag color="white" size="large">{renderNumber(record.request_count)}</Tag>
    )
  },
  {
    title: '角色', dataIndex: 'role', width: 100, align: 'center', render: (text, record, index) => {
      return (<div style={{ display: 'flex', justifyContent: 'center' }}>
        {renderRole(text)}
      </div>);
    }
  },
  {
    title: '状态', dataIndex: 'status', width: 90, align: 'center', render: (text, record, index) => {
      return (<div style={{ display: 'flex', justifyContent: 'center' }}>
        {renderStatus(text)}
      </div>);
    }
  },
  {
    title: '标签', dataIndex: 'tags', width: 200, align: 'center', render: (tags) => {
      if (!tags || tags.length === 0) return <Typography.Text type="tertiary">-</Typography.Text>;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
          {tags.map((t) => (
            <Tag key={t.id} color="blue">{t.name}</Tag>
          ))}
        </div>
      );
    }
  },
  {
    title: '', dataIndex: 'operate', width: 240, align: 'center', render: (text, record, index) => (<div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', justifyContent: 'center' }}>
      <Button theme="light" type="tertiary" onClick={() => {
        setEditingUser(record);
        setShowEditUser(true);
      }}>编辑</Button>
      <Button theme="light" type="tertiary" onClick={() => {
        setActivityUser(record);
        setActivityModalVisible(true);
      }}>详情</Button>
      <Dropdown
        trigger="click"
        position="bottomRight"
        render={
          <Dropdown.Menu>
            {record.status === 1 ? (
              <Dropdown.Item onClick={() => {
                openAdminPasswordModal(record, 'disable');
              }}>
                禁用
              </Dropdown.Item>
            ) : (
              <Dropdown.Item onClick={() => {
                manageUser(record.username, 'enable', record);
              }} disabled={record.status === 3}>
                启用
              </Dropdown.Item>
            )}
            <Dropdown.Item onClick={() => {
              openAdminPasswordModal(record, 'delete');
            }}>
              删除
            </Dropdown.Item>
            <Dropdown.Item type="danger" onClick={() => {
              openAdminPasswordModal(record, 'hard_delete');
            }}>
              彻底删除
            </Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <Button theme="light" type="secondary">更多</Button>
      </Dropdown>
    </div>)
  }];

  const { visibleColumns: columns, columnConfigButton } = useColumnConfig({
    storageKey: COLUMN_STORAGE_KEY,
    columnMeta: COLUMN_META,
    allColumns,
    buttonProps: {
      theme: 'borderless',
      type: 'tertiary',
      style: { color: 'var(--semi-color-text-0)' },
      children: '显示项',
    },
  });

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [userCount, setUserCount] = useState(20);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [editingUser, setEditingUser] = useState({
    id: undefined
  });
  const [orderBy, setOrderBy] = useState('');
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [adminPasswordModalVisible, setAdminPasswordModalVisible] = useState(false);
  const [pendingManageAction, setPendingManageAction] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [activityModalVisible, setActivityModalVisible] = useState(false);
  const [activityUser, setActivityUser] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const setCount = (data) => {
    if (data.length >= activePage * pageSize) {
      setUserCount(data.length + 1);
    } else {
      setUserCount(data.length);
    }
  };

  const loadUsers = async (startIdx) => {
    const res = await API.get(`/api/user/?p=${startIdx}&size=${pageSize}&order=${orderBy}`);
    const { success, message, data } = res.data;
    if (success) {
      if (startIdx === 0) {
        setUsers(data);
        setCount(data);
      } else {
        let newUsers = users;
        newUsers.push(...data);
        setUsers(newUsers);
        setCount(newUsers);
      }
    } else {
      showError(message);
    }
    setLoading(false);
  };

  const onPaginationChange = (e, { activePage }) => {
    (async () => {
      if (activePage === Math.ceil(users.length / pageSize) + 1) {
        await loadUsers(activePage - 1, orderBy);
      }
      setActivePage(activePage);
    })();
  };

  useEffect(() => {
    setLoading(true);
    setActivePage(1);
    loadUsers(0, orderBy)
      .then()
      .catch((reason) => {
        showError(reason);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderBy, pageSize]);

  const manageUser = async (username, action, record, password = '') => {
    const res = await API.post('/api/user/manage', {
      username,
      action,
      admin_password: password
    });
    const { success, message } = res.data;
    if (success) {
      showSuccess('操作成功完成！');
      let user = res.data.data;
      if (action === 'delete' || action === 'hard_delete') {
        setUsers(users.filter(user => user.id !== record.id));
      } else {
        let newUsers = [...users];
        record.status = user.status;
        record.role = user.role;
        setUsers(newUsers);
      }
      return true;
    } else {
      showError(message);
      return false;
    }
  };

  const openAdminPasswordModal = (record, action) => {
    setPendingManageAction({ record, action });
    setAdminPassword('');
    setAdminPasswordModalVisible(true);
  };

  // 批量删除 / 彻底删除：复用同一个管理员密码确认弹窗，batch=true 标记批量模式
  const openBatchPasswordModal = (action) => {
    if (selectedRowKeys.length === 0) {
      showError('请先选择用户');
      return;
    }
    setPendingManageAction({ action, batch: true, count: selectedRowKeys.length });
    setAdminPassword('');
    setAdminPasswordModalVisible(true);
  };

  const batchManageUsers = async (action, password) => {
    try {
      const res = await API.post('/api/user/batch_manage', {
        ids: selectedRowKeys,
        action,
        admin_password: password,
      });
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return false;
      }
      const successIds = data?.success_ids || [];
      const failCount = data?.fail_count || 0;
      if (successIds.length > 0) {
        setUsers((prev) => prev.filter((u) => !successIds.includes(u.id)));
      }
      setSelectedRowKeys((prev) => prev.filter((k) => !successIds.includes(k)));
      if (failCount > 0) {
        const firstMsg = data?.failures?.[0]?.message || '';
        showError(`成功 ${data.success_count} 个，失败 ${failCount} 个${firstMsg ? `：${firstMsg}` : ''}`);
      } else {
        showSuccess(`已${action === 'hard_delete' ? '彻底删除' : '删除'} ${data.success_count} 个用户`);
      }
      return true;
    } catch (err) {
      showError(err.message || '批量操作失败');
      return false;
    }
  };

  const closeAdminPasswordModal = () => {
    setAdminPasswordModalVisible(false);
    setPendingManageAction(null);
    setAdminPassword('');
  };

  const submitManageActionWithPassword = async () => {
    if (!adminPassword) {
      showError('请输入管理员密码');
      return;
    }
    if (!pendingManageAction) {
      return;
    }
    const { record, action, batch } = pendingManageAction;
    const ok = batch
      ? await batchManageUsers(action, adminPassword)
      : await manageUser(record.username, action, record, adminPassword);
    if (ok) {
      closeAdminPasswordModal();
    }
  };

  const renderStatus = (status) => {
    switch (status) {
      case 1:
        return <Tag size="large">已激活</Tag>;
      case 2:
        return (<Tag size="large" color="red">
          已封禁
        </Tag>);
      default:
        return (<Tag size="large" color="grey">
          未知状态
        </Tag>);
    }
  };

  const searchUsers = async () => {
    if (searchKeyword === '') {
      // if keyword is blank, load files instead.
      await loadUsers(0);
      setActivePage(1);
      setOrderBy('');
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/user/search?keyword=${searchKeyword}`);
    const { success, message, data } = res.data;
    if (success) {
      setUsers(data);
      setActivePage(1);
    } else {
      showError(message);
    }
    setSearching(false);
  };

  const handleKeywordChange = async (value) => {
    const kw = value.trim();
    setSearchKeyword(kw);
    if (kw === '') {
      await loadUsers(0);
      setActivePage(1);
      return;
    }
    setSearching(true);
    const res = await API.get(`/api/user/search?keyword=${kw}`);
    const { success, data } = res.data;
    if (success) {
      setUsers(data);
      setActivePage(1);
    }
    setSearching(false);
  };

  const sortUser = (key) => {
    if (users.length === 0) return;
    setLoading(true);
    let sortedUsers = [...users];
    sortedUsers.sort((a, b) => {
      return ('' + a[key]).localeCompare(b[key]);
    });
    if (sortedUsers[0].id === users[0].id) {
      sortedUsers.reverse();
    }
    setUsers(sortedUsers);
    setLoading(false);
  };

  const handlePageChange = page => {
    setActivePage(page);
    if (page === Math.ceil(users.length / pageSize) + 1) {
      loadUsers(page - 1).then(r => {
      });
    }
  };

  const pageData = users.slice((activePage - 1) * pageSize, activePage * pageSize);

  const closeAddUser = () => {
    setShowAddUser(false);
  };

  const closeEditUser = () => {
    setShowEditUser(false);
    setEditingUser({
      id: undefined
    });
  };

  const refresh = async () => {
    if (searchKeyword === '') {
      await loadUsers(activePage - 1);
    } else {
      await searchUsers();
    }
  };

  const handleOrderByChange = (e, { value }) => {
    setOrderBy(value);
    setActivePage(1);
    setDropdownVisible(false);
  };

  const renderSelectedOption = (orderBy) => {
    switch (orderBy) {
      case 'quota':
        return '按剩余额度排序';
      case 'used_quota':
        return '按已用额度排序';
      case 'request_count':
        return '按请求次数排序';
      default:
        return '默认排序';
    }
  };

  return (
    <>
      <Modal
        title={
          pendingManageAction?.action === 'hard_delete'
            ? '彻底删除用户确认'
            : pendingManageAction?.action === 'delete'
              ? '删除用户确认'
              : '禁用用户确认'
        }
        visible={adminPasswordModalVisible}
        onOk={submitManageActionWithPassword}
        onCancel={closeAdminPasswordModal}
        okText={pendingManageAction?.action === 'hard_delete' ? '确认彻底删除' : '确认提交'}
        cancelText="取消"
        okButtonProps={{ type: pendingManageAction?.action === 'enable' ? 'warning' : 'danger' }}
      >
        {pendingManageAction?.batch ? (
          pendingManageAction?.action === 'hard_delete' ? (
            <Typography.Text type="danger">
              将<Typography.Text type="danger" strong>物理删除</Typography.Text>所选{' '}
              <Typography.Text type="danger" strong>{pendingManageAction?.count}</Typography.Text>{' '}
              个用户及其全部关联数据（额度、令牌、订单、活动、邀请、日志、账号中心标识等），
              <Typography.Text type="danger" strong>不可恢复</Typography.Text>
              。请输入管理员密码确认。
            </Typography.Text>
          ) : (
            <Typography.Text>
              删除所选{' '}
              <Typography.Text strong>{pendingManageAction?.count}</Typography.Text>{' '}
              个用户后，这些用户将不可继续使用。请输入管理员密码确认。
            </Typography.Text>
          )
        ) : pendingManageAction?.action === 'hard_delete' ? (
          <Typography.Text type="danger">
            将<Typography.Text type="danger" strong>物理删除</Typography.Text>用户{' '}
            {pendingManageAction?.record?.username || ''}{' '}
            及其全部关联数据（额度、令牌、订单、活动、邀请、日志、账号中心标识等），
            <Typography.Text type="danger" strong>不可恢复</Typography.Text>
            。删除后该手机号可重新注册。请输入管理员密码确认。
          </Typography.Text>
        ) : (
          <Typography.Text>
            {pendingManageAction?.action === 'delete'
              ? `删除用户 ${pendingManageAction?.record?.username || ''} 后，该用户将不可继续使用。请输入管理员密码确认。`
              : `禁用用户 ${pendingManageAction?.record?.username || ''} 后，该用户将不能正常使用。请输入管理员密码确认。`}
          </Typography.Text>
        )}
        <Input
          style={{ marginTop: 16 }}
          type="password"
          placeholder="请输入管理员密码"
          value={adminPassword}
          onChange={setAdminPassword}
          autoComplete="new-password"
        />
      </Modal>
      <AddUser refresh={refresh} visible={showAddUser} handleClose={closeAddUser}></AddUser>
      <EditUser refresh={refresh} visible={showEditUser} handleClose={closeEditUser}
        editingUser={editingUser}></EditUser>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <Input
            prefix={<IconSearch />}
            placeholder="搜索用户的 ID，用户名，显示名称，以及邮箱地址 ..."
            value={searchKeyword}
            onChange={value => handleKeywordChange(value)}
            showClear
            style={{ width: 360 }}
          />
          <div style={{ flex: 1 }} />
          {selectedRowKeys.length > 0 && (
            <>
              <Typography.Text type="tertiary" style={{ marginRight: 4 }}>
                已选 {selectedRowKeys.length} 个
              </Typography.Text>
              <Button
                theme="light"
                type="danger"
                onClick={() => openBatchPasswordModal('delete')}
              >
                批量删除
              </Button>
              <Button
                theme="solid"
                type="danger"
                onClick={() => openBatchPasswordModal('hard_delete')}
              >
                批量彻底删除
              </Button>
            </>
          )}
          <Dropdown
            trigger="click"
            position="bottomRight"
            visible={dropdownVisible}
            onVisibleChange={(visible) => setDropdownVisible(visible)}
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => handleOrderByChange('', { value: '' })}>默认排序</Dropdown.Item>
                <Dropdown.Item onClick={() => handleOrderByChange('', { value: 'quota' })}>按剩余额度排序</Dropdown.Item>
                <Dropdown.Item onClick={() => handleOrderByChange('', { value: 'used_quota' })}>按已用额度排序</Dropdown.Item>
                <Dropdown.Item onClick={() => handleOrderByChange('', { value: 'request_count' })}>按请求次数排序</Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button theme="borderless" type="tertiary" style={{ color: 'var(--semi-color-text-0)' }}>
              {renderSelectedOption(orderBy)}
            </Button>
          </Dropdown>
          <Button
            theme="borderless"
            type="tertiary"
            style={{ color: 'var(--semi-color-text-0)' }}
            onClick={() => setShowAddUser(true)}
          >
            添加用户
          </Button>
          {columnConfigButton}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Table
            columns={columns}
            dataSource={pageData}
            rowKey="id"
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              getCheckboxProps: (record) => ({
                disabled: record.role === 100, // 超级管理员不可删除
              }),
            }}
            expandedRowRender={(record) => <UserTokensSubTable userId={record.id} />}
            expandRowByClick={true}
            scroll={{ y: 'calc(100vh - 245px)' }}
            sticky={{ top: 0 }}
            pagination={{
              currentPage: activePage,
              pageSize: pageSize,
              total: userCount,
              showSizeChanger: true,
              pageSizeOpts: [20, 50, 100],
              formatPageText: (page) => `第 ${page.currentStart} - ${page.currentEnd} 条，共 ${users.length} 条`,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setActivePage(1);
              },
              onPageChange: handlePageChange
            }}
            loading={loading}
          />
        </div>
      </div>

      <UserActivityModal
        visible={activityModalVisible}
        userId={activityUser?.id}
        username={activityUser?.username}
        onClose={() => {
          setActivityModalVisible(false);
          setActivityUser(null);
        }}
      />
    </>
  );
};

export default UsersTable;
