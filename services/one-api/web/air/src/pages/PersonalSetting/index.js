import React from 'react';
import PersonalSetting from '../../components/PersonalSetting';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import AdminPageFrame from '../../components/AdminPageFrame';

const PersonalSettingPage = () => {
  return (
    <AdminPageFrame
      kicker="ACCOUNT SETTINGS"
      title="账户设置"
      description="管理当前管理员账户和登录安全设置。"
    >
      <ConfigPageTabs defaultActiveKey="1">
        <ConfigPageTabPane itemKey="1" tab="个人设置">
          <PersonalSetting />
        </ConfigPageTabPane>
      </ConfigPageTabs>
    </AdminPageFrame>
  );
};

export default PersonalSettingPage;
