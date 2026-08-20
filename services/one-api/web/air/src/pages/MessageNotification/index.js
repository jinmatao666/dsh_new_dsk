import React from 'react';
import { Layout, Typography } from '@douyinfe/semi-ui';
import { Bell } from 'lucide-react';

const { Title, Text } = Typography;

// 消息通知（占位页）：站内信、推送、公告等通知配置与下发。
// 后端接口与具体功能后续单独开发。
const MessageNotification = () => (
  <Layout style={{ padding: '24px', height: '100%' }}>
    <Layout.Header style={{ marginBottom: 8 }}>
      <Title heading={3} style={{ margin: 0 }}>消息通知</Title>
      <Text type="tertiary">站内信、推送通知、系统公告的配置与下发</Text>
    </Layout.Header>
    <Layout.Content
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 360,
        color: 'var(--semi-color-text-2)'
      }}
    >
      <Bell size={44} strokeWidth={1.5} />
      <Text type="tertiary" style={{ fontSize: 15 }}>功能建设中，敬请期待</Text>
    </Layout.Content>
  </Layout>
);

export default MessageNotification;
