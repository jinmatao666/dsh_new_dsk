import React from 'react';
import PersonalSetting from '../../components/PersonalSetting';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const PersonalSettingPage = () => {
  return (
    <ConfigPageTabs defaultActiveKey="1">
      <ConfigPageTabPane itemKey="1" tab="个人设置">
        <PersonalSetting />
      </ConfigPageTabPane>
    </ConfigPageTabs>
  );
};

export default PersonalSettingPage;
