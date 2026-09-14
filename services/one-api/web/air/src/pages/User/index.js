import React, { useState } from 'react';
import UsersTable from '../../components/UsersTable';
import AdminPageFrame from '../../components/AdminPageFrame';
import RolePermissions from '../../components/RolePermissions';
import { ConfigPageLayout, ConfigPageTabs, ConfigPageTabPane } from '../../components/ConfigPageLayout';

const User = () => {
  const [activeKey, setActiveKey] = useState('users');
  return <AdminPageFrame
    kicker="ACCESS CONTROL"
    title="用户权限"
    description="管理用户账号与角色可见模型。"
  >
    <ConfigPageLayout>
      <ConfigPageTabs activeKey={activeKey} onChange={setActiveKey}>
        <ConfigPageTabPane tab="用户管理" itemKey="users"><UsersTable /></ConfigPageTabPane>
        <ConfigPageTabPane tab="角色权限" itemKey="roles"><RolePermissions /></ConfigPageTabPane>
      </ConfigPageTabs>
    </ConfigPageLayout>
  </AdminPageFrame>;
};

export default User;
