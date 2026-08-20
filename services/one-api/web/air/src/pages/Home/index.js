import React from 'react';
import { Link } from 'react-router-dom';
import { Layout, Typography } from '@douyinfe/semi-ui';
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  Gift,
  Layers,
  Package,
  ReceiptText,
  Radar,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  User,
  UserCog,
  Users
} from 'lucide-react';
import { isAdmin } from '../../helpers';

const { Title, Text } = Typography;

const SECTIONS = [
  {
    text: '配置',
    icon: SlidersHorizontal,
    desc: '管理后台与外部服务的对接配置。',
    adminOnly: true,
    items: [
      { text: '渠道', icon: Layers, to: '/channel', desc: '配置上游模型渠道、密钥、分组与限流，决定请求的实际转发去向。' },
      { text: 'Skill 管理', icon: Sparkles, to: '/skill', desc: '维护内置与用户上传的技能清单、可见性与上下架状态。' }
    ]
  },
  {
    text: '账户管理',
    icon: Users,
    desc: '管理使用者及其归属。',
    adminOnly: true,
    items: [
      { text: '用户管理', icon: User, to: '/user', desc: '查看与维护用户账号、额度、Token 与权限。' },
      { text: '企业管理', icon: Users, to: '/organization', desc: '管理企业组织、成员归属与企业级配额。' }
    ]
  },
  {
    text: '交易中心',
    icon: ReceiptText,
    desc: '管理可售商品、支付订单与发票记录。',
    adminOnly: true,
    items: [
      { text: '商品管理', icon: Package, to: '/transaction/products', desc: '维护个人商品与企业商品的名称、价格、积分、排序和启用状态。' },
      { text: '订单管理', icon: Gift, to: '/transaction/orders', desc: '统一查看交易订单、支付状态、发票申请与交易流水。' }
    ]
  },
  {
    text: '运营工具',
    icon: Gift,
    desc: '围绕用户、活动、积分和触达的集中运营工作台。',
    adminOnly: true,
    items: [
      { text: '运营看板', icon: BarChart3, to: '/operation/dashboard', desc: '查看运营指标、任务记录，并逐步收敛原有看板入口。' },
      { text: '用户运营', icon: UserCog, to: '/operation/user', desc: '在同一工作台内完成分群筛选、标签管理与批量动作发起。' },
      { text: '活动管理', icon: Ticket, to: '/operation/activity', desc: '配置自动化活动规则、目标对象和奖励内容。' },
      { text: '消息通知', icon: Bell, to: '/operation/message', desc: '站内信、推送通知与系统公告的配置与下发。' }
    ]
  },
  {
    text: '日志监控',
    icon: Activity,
    desc: '查看运行状态、调用记录与后台审计。',
    items: [
      { text: '监控看板', icon: Radar, to: '/monitor-board', desc: '聚合展示客户端事件、错误埋点与关键指标的实时趋势。' },
      { text: '日志详情', icon: ClipboardList, to: '/log', desc: '按用户、模型、Token 等维度检索每一次请求的详细日志。' },
      { text: '后台操作记录', icon: Activity, to: '/admin-operation-log', desc: '检索后台管理员的关键写操作记录，后续承接更多审计类型。' }
    ]
  },
  {
    text: '设置',
    icon: Settings,
    to: '/setting',
    desc: '系统全局参数、登录方式、通知与外观等配置。'
  }
];

const cardStyle = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 10,
  padding: '16px 18px'
};

const subItemStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  transition: 'background-color 150ms ease'
};

const SectionCard = ({ section }) => {
  const Icon = section.icon;
  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: section.items ? 12 : 6, height: 22 }}>
      <Icon size={18} strokeWidth={1.75} style={{ color: 'var(--semi-color-text-1)', display: 'block', flexShrink: 0 }} />
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 1,
        color: 'var(--semi-color-text-0)'
      }}>
        {section.text}
      </span>
    </div>
  );

  if (!section.items) {
    return (
      <Link to={section.to} style={{ ...cardStyle, display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {header}
        <Text type="tertiary" style={{ fontSize: 13, lineHeight: 1.6 }}>{section.desc}</Text>
      </Link>
    );
  }

  return (
    <div style={cardStyle}>
      {header}
      <Text type="tertiary" style={{ fontSize: 13, lineHeight: 1.6, display: 'block', marginBottom: 8 }}>
        {section.desc}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {section.items.map((item) => {
          const SubIcon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              style={subItemStyle}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--semi-color-fill-0)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <SubIcon size={15} strokeWidth={1.75} style={{ marginTop: 2, color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>{item.text}</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--semi-color-text-2)', marginTop: 2 }}>
                  {item.desc}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

const Home = () => {
  const admin = isAdmin();
  const sections = SECTIONS.filter((s) => !s.adminOnly || admin);

  return (
    <Layout style={{ padding: '32px 32px 48px', maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <Title heading={3} style={{ margin: 0 }}>点石后台</Title>
        <Text type="tertiary" style={{ fontSize: 13, marginTop: 6, display: 'block', lineHeight: 1.6 }}>
          以下是后台各节点的功能简介，可点击对应卡片或左侧导航进入。
        </Text>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16
        }}
      >
        {sections.map((section) => (
          <SectionCard key={section.text} section={section} />
        ))}
      </div>
    </Layout>
  );
};

export default Home;
