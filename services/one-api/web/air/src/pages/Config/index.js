import React from 'react';
import { Layout, Typography } from '@douyinfe/semi-ui';

const { Title, Text } = Typography;

const Config = () => {
  return (
    <Layout style={{ padding: '24px' }}>
      <Title heading={3}>配置</Title>
      <Text type="tertiary">渠道、Skill 等配置项</Text>
    </Layout>
  );
};

export default Config;
