import React from 'react';
import UsersTable from '../../components/UsersTable';
import AdminPageFrame from '../../components/AdminPageFrame';

const User = () => (
  <AdminPageFrame
    kicker="ACCESS CONTROL"
    title="用户管理"
    description="管理登录账号、权限、令牌和使用额度。"
  >
    <UsersTable />
  </AdminPageFrame>
);

export default User;
