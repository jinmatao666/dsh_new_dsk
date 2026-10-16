import React from 'react';
import SystemSetting from '../../components/SystemSetting';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const SystemSettingPage = () => {
  return (
    <ConfigPageTabs defaultActiveKey="1">
      <ConfigPageTabPane itemKey="1" tab="系统设置">
        <SystemSetting />
      </ConfigPageTabPane>
    </ConfigPageTabs>
  );
};

export default SystemSettingPage;
