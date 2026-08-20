import React from 'react';
import LogCleanupSetting from '../../components/LogCleanupSetting';
import OnlineDataSync from '../../components/OnlineDataSync';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';

const Toolbox = () => {
  return (
    <ConfigPageTabs defaultActiveKey="1">
      <ConfigPageTabPane itemKey="1" tab="日志清理">
        <LogCleanupSetting />
      </ConfigPageTabPane>
      <ConfigPageTabPane itemKey="2" tab="线上数据同步">
        <OnlineDataSync />
      </ConfigPageTabPane>
    </ConfigPageTabs>
  );
};

export default Toolbox;
