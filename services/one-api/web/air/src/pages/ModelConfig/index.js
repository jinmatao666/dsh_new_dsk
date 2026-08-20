import React, { useState } from 'react';
import ModelManagement from '../../components/ModelManagement';
import BasicSettings from '../../components/BasicSettings';
import ChannelsTable from '../../components/ChannelsTable';
import { ConfigPageLayout, ConfigPageTabs, ConfigPageTabPane } from '../../components/ConfigPageLayout';

// 渠道与模型配置页。三个 tab:
//   - 渠道配置:渠道本体(连通性测试、启停、复制、优先级),复用 ChannelsTable
//   - 模型配置:列表形态 + 行内编辑(模型↔渠道来源、倍率、上下文)
//   - 基础设置:预扣额度 + 默认上下文限制(倍率/上下文映射已迁入模型配置逐模型维护)
//
// 渠道作为第一个 tab,符合「先配渠道再挂模型」的操作顺序。
const ModelConfigPage = () => {
  const [activeKey, setActiveKey] = useState('channels');
  return (
    <ConfigPageLayout>
      <ConfigPageTabs activeKey={activeKey} onChange={setActiveKey}>
        <ConfigPageTabPane tab="渠道配置" itemKey="channels">
          <ChannelsTable />
        </ConfigPageTabPane>
        <ConfigPageTabPane tab="模型配置" itemKey="models">
          <ModelManagement />
        </ConfigPageTabPane>
        <ConfigPageTabPane tab="基础设置" itemKey="basic">
          <BasicSettings />
        </ConfigPageTabPane>
      </ConfigPageTabs>
    </ConfigPageLayout>
  );
};

export default ModelConfigPage;
