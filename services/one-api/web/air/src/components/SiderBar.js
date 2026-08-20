import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserContext } from '../context/User';
import { StatusContext } from '../context/Status';
import { ProductContext } from '../context/Product';

import { API, hasPermission, isAdmin, isMobile, isRoot, showError } from '../helpers';
import '../index.css';

import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ClipboardList,
  Cpu,
  Gauge,
  Gift,
  Home,
  Hourglass,
  Image as ImageIcon,
  Lock,
  Megaphone,
  MessageSquare,
  Package,
  QrCode,
  ReceiptText,
  Radar,
  Rocket,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  User,
  UserCog,
  Users,
  Wand2,
  Wrench
} from 'lucide-react';
import { Layout, Nav } from '@douyinfe/semi-ui';

const navIconSize = 16;
const navIconStrokeWidth = 1.75;
const NavIcon = ({ as: Component }) => (
  <Component size={navIconSize} strokeWidth={navIconStrokeWidth} />
);

// HeaderBar Buttons

const SiderBar = () => {
  const [userState, userDispatch] = useContext(UserContext);
  const [statusState, statusDispatch] = useContext(StatusContext);
  const { activeProduct, activeProductMeta } = useContext(ProductContext);
  const defaultIsCollapsed = isMobile() || localStorage.getItem('default_collapse_sidebar') === 'true';

  const location = useLocation();
  const [openKeys, setOpenKeys] = useState([]);
  const [isCollapsed, setIsCollapsed] = useState(defaultIsCollapsed);

  // 当前后台全部菜单归属 parvis 产品。其他产品暂为占位，菜单为空。
  const parvisButtons = useMemo(() => [
    {
      text: '首页',
      itemKey: 'home',
      to: '/',
      icon: <NavIcon as={Home} />
    },
    {
      text: '配置',
      itemKey: 'config',
      icon: <NavIcon as={SlidersHorizontal} />,
      className: isAdmin() ? 'semi-navigation-item-normal' : 'tableHiddle',
      items: [
        {
          text: '模型配置',
          itemKey: 'model-config',
          to: '/config/model',
          icon: <NavIcon as={Cpu} />,
          className: 'nav-subitem'
        },
        {
          text: 'Skill 管理',
          itemKey: 'skill',
          to: '/skill',
          icon: <NavIcon as={Sparkles} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '账户管理',
      itemKey: 'user-manage',
      icon: <NavIcon as={Users} />,
      className: isAdmin() ? 'semi-navigation-item-normal' : 'tableHiddle',
      items: [
        {
          text: '用户管理',
          itemKey: 'user',
          to: '/user',
          icon: <NavIcon as={User} />,
          className: 'nav-subitem'
        },
        {
          text: '企业管理',
          itemKey: 'organization',
          to: '/organization',
          icon: <NavIcon as={Building2} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '交易中心',
      itemKey: 'trade-center',
      icon: <NavIcon as={ReceiptText} />,
      className: isAdmin() ? 'semi-navigation-item-normal' : 'tableHiddle',
      items: [
        {
          text: '商品管理',
          itemKey: 'transaction-products',
          to: '/transaction/products',
          icon: <NavIcon as={Package} />,
          className: 'nav-subitem'
        },
        {
          text: '订单管理',
          itemKey: 'transaction-orders',
          to: '/transaction/orders',
          icon: <NavIcon as={Gift} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '运营工具',
      itemKey: 'operation-tools',
      icon: <NavIcon as={Gift} />,
      className: isAdmin() ? 'semi-navigation-item-normal' : 'tableHiddle',
      items: [
        {
          text: '运营看板',
          itemKey: 'operation-dashboard',
          to: '/operation/dashboard',
          icon: <NavIcon as={BarChart3} />,
          className: 'nav-subitem'
        },
        {
          text: '用户运营',
          itemKey: 'user-operation',
          to: '/operation/user',
          icon: <NavIcon as={UserCog} />,
          className: 'nav-subitem'
        },
        {
          text: '活动管理',
          itemKey: 'activity-config',
          to: '/operation/activity',
          icon: <NavIcon as={Ticket} />,
          className: 'nav-subitem'
        },
        {
          text: '兑换码',
          itemKey: 'influencer-code',
          to: '/operation/influencer-code',
          icon: <NavIcon as={QrCode} />,
          className: 'nav-subitem'
        },
        {
          text: '消息通知',
          itemKey: 'message-notification',
          to: '/operation/message',
          icon: <NavIcon as={Bell} />,
          className: 'nav-subitem'
        },
        {
          text: '通知管理',
          itemKey: 'notification-manage',
          to: '/operation/notification',
          icon: <NavIcon as={Megaphone} />,
          className: 'nav-subitem'
        },
        {
          text: '版本发布',
          itemKey: 'version-release',
          to: '/operation/version-release',
          icon: <NavIcon as={Rocket} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '数据看板',
      itemKey: 'data-board',
      icon: <NavIcon as={BarChart3} />,
      className: isAdmin() ? 'semi-navigation-item-normal' : 'tableHiddle',
      items: [
        {
          text: 'Parvis看板',
          itemKey: 'parvis-dashboard',
          to: '/parvis-dashboard',
          icon: <NavIcon as={Gauge} />,
          className: 'nav-subitem'
        },
        {
          text: '自定义看板',
          itemKey: 'custom-board',
          to: '/data-board/custom',
          icon: <NavIcon as={Wand2} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '日志监控',
      itemKey: 'log-monitor',
      icon: <NavIcon as={Activity} />,
      items: [
        {
          text: '监控看板',
          itemKey: 'monitor-board',
          to: '/monitor-board',
          icon: <NavIcon as={Radar} />,
          className: 'nav-subitem'
        },
        {
          text: '日志详情',
          itemKey: 'log',
          to: '/log',
          icon: <NavIcon as={ClipboardList} />,
          className: 'nav-subitem'
        },
        {
          text: '后台操作记录',
          itemKey: 'admin-operation-log',
          to: '/admin-operation-log',
          icon: <NavIcon as={ShieldCheck} />,
          className: 'nav-subitem'
        },
        {
          text: '用户反馈',
          itemKey: 'feedback',
          to: '/feedback',
          icon: <NavIcon as={MessageSquare} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '设置',
      itemKey: 'settings-group',
      icon: <NavIcon as={Settings} />,
      items: [
        {
          text: '个人设置',
          itemKey: 'personal-setting',
          to: '/setting/personal',
          icon: <NavIcon as={User} />,
          className: 'nav-subitem'
        },
        {
          text: '系统设置',
          itemKey: 'system-setting',
          to: '/setting/system',
          icon: <NavIcon as={SlidersHorizontal} />,
          className: 'nav-subitem'
        },
        {
          text: '后台权限管理',
          itemKey: 'admin-permissions',
          to: '/setting/admin-permissions',
          icon: <NavIcon as={Lock} />,
          className: 'nav-subitem'
        },
        {
          text: '工具箱',
          itemKey: 'toolbox',
          to: '/setting/toolbox',
          icon: <NavIcon as={Wrench} />,
          className: 'nav-subitem'
        }
      ]
    },
    {
      text: '聊天',
      itemKey: 'chat',
      to: '/chat',
      icon: <NavIcon as={MessageSquare} />,
      className: localStorage.getItem('chat_link') ? 'semi-navigation-item-normal' : 'tableHiddle'
    },
    {
      text: '数据看板（旧）',
      itemKey: 'detail',
      to: '/detail',
      icon: <NavIcon as={CalendarClock} />,
      className: localStorage.getItem('enable_data_export') === 'true' ? 'semi-navigation-item-normal' : 'tableHiddle'
    },
    {
      text: '绘图',
      itemKey: 'midjourney',
      to: '/midjourney',
      icon: <NavIcon as={ImageIcon} />,
      className: localStorage.getItem('enable_drawing') === 'true' ? 'semi-navigation-item-normal' : 'tableHiddle'
    }
  ], [localStorage.getItem('enable_data_export'), localStorage.getItem('enable_drawing'), localStorage.getItem('chat_link'), isAdmin(), isRoot()]);

  // 按当前产品过滤菜单：parvis 显示完整菜单，其他产品暂无菜单（占位）。
  const headerButtons = useMemo(() => {
    if (activeProduct === 'parvis') return parvisButtons;
    return [];
  }, [activeProduct, parvisButtons]);

  const loadStatus = async () => {
    const res = await API.get('/api/status');
    const { success, data } = res.data;
    if (success) {
      localStorage.setItem('status', JSON.stringify(data));
      statusDispatch({ type: 'set', payload: data });
      localStorage.setItem('system_name', data.system_name);
      localStorage.setItem('logo', data.logo);
      localStorage.setItem('footer_html', data.footer_html);
      localStorage.setItem('quota_per_unit', data.quota_per_unit);
      localStorage.setItem('display_in_currency', data.display_in_currency);
      localStorage.setItem('enable_drawing', data.enable_drawing);
      localStorage.setItem('enable_data_export', data.enable_data_export);
      localStorage.setItem('data_export_default_time', data.data_export_default_time);
      localStorage.setItem('default_collapse_sidebar', data.default_collapse_sidebar);
      localStorage.setItem('mj_notify_enabled', data.mj_notify_enabled);
      if (data.chat_link) {
        localStorage.setItem('chat_link', data.chat_link);
      } else {
        localStorage.removeItem('chat_link');
      }
      if (data.chat_link2) {
        localStorage.setItem('chat_link2', data.chat_link2);
      } else {
        localStorage.removeItem('chat_link2');
      }
    } else {
      showError('无法正常连接至服务器！');
    }
  };

  useEffect(() => {
    loadStatus().then(() => {
      setIsCollapsed(isMobile() || localStorage.getItem('default_collapse_sidebar') === 'true');
    });
  }, []);

  const { selectedKeys, parentKey } = useMemo(() => {
    const path = location.pathname;
    let bestKey = null;
    let bestParent = null;
    let bestLen = -1;
    const walk = (items, parent) => {
      for (const item of items) {
        if (item.items) {
          walk(item.items, item.itemKey);
        } else if (item.to) {
          const isMatch = item.to === '/'
            ? path === '/'
            : path === item.to || path.startsWith(item.to + '/');
          if (isMatch && item.to.length > bestLen) {
            bestKey = item.itemKey;
            bestParent = parent;
            bestLen = item.to.length;
          }
        }
      }
    };
    walk(headerButtons, null);
    return { selectedKeys: bestKey ? [bestKey] : ['home'], parentKey: bestParent };
  }, [location.pathname, headerButtons]);

  useEffect(() => {
    if (parentKey) {
      // 仅保持当前路由所属父节点展开，其余收起
      setOpenKeys((prev) => (prev.length === 1 && prev[0] === parentKey ? prev : [parentKey]));
    }
  }, [parentKey]);

  return (
    <>
      <Layout>
        <div style={{ height: '100%' }}>
          <Nav
            // bodyStyle={{ maxWidth: 200 }}
            style={{ maxWidth: 200 }}
            defaultIsCollapsed={isMobile() || localStorage.getItem('default_collapse_sidebar') === 'true'}
            isCollapsed={isCollapsed}
            onCollapseChange={collapsed => {
              setIsCollapsed(collapsed);
            }}
            selectedKeys={selectedKeys}
            openKeys={openKeys}
            onOpenChange={({ itemKey, isOpen, openKeys: keys }) => {
              // 手风琴模式：每次仅展开一个父节点，展开新节点时收起其他节点
              if (isOpen) {
                setOpenKeys([itemKey]);
              } else {
                setOpenKeys(keys.filter((key) => key !== itemKey));
              }
            }}
            renderWrapper={({ itemElement, isSubNav, isInSubNav, props }) => {
              const routerMap = {
                home: '/',
                channel: '/channel',
                user: '/user',
                operation: '/operation',
                log: '/log',
                dashboard: '/dashboard',
                midjourney: '/midjourney',
                setting: '/setting',
                about: '/about',
                chat: '/chat',
                detail: '/detail',
                organization: '/organization',
                'parvis-dashboard': '/parvis-dashboard',
                skill: '/skill',
                'model-config': '/config/model',
                'quota-config': '/config/quota',
                'transaction-products': '/transaction/products',
                'transaction-orders': '/transaction/orders',
                'operation-dashboard': '/operation/dashboard',
                'activity-config': '/operation/activity',
                'influencer-code': '/operation/influencer-code',
                'user-operation': '/operation/user',
                'message-notification': '/operation/message',
                'notification-manage': '/operation/notification',
                'version-release': '/operation/version-release',
                'monitor-board': '/monitor-board',
                'admin-operation-log': '/admin-operation-log',
                'feedback': '/feedback',
                'custom-board': '/data-board/custom',
                'account-type-changes': '/account-type-changes',
                'personal-setting': '/setting/personal',
                'system-setting': '/setting/system',
                'admin-permissions': '/setting/admin-permissions',
                'toolbox': '/setting/toolbox'
              };
              const target = routerMap[props.itemKey];
              if (isSubNav || !target) {
                return itemElement;
              }
              return (
                <Link
                  style={{ textDecoration: 'none' }}
                  to={target}
                >
                  {itemElement}
                </Link>
              );
            }}
            items={headerButtons}
            header={
              !isCollapsed && (
                <div className="sider-header">
                  <div className="sider-header-title">点石后台</div>
                </div>
              )
            }
            // footer={{
            //   text: '© 2021 NekoAPI',
            // }}
          >
            {activeProductMeta.placeholder && !isCollapsed && (
              <div className="product-empty-hint">
                <Hourglass size={26} strokeWidth={1.5} />
                <div className="product-empty-hint-title">{activeProductMeta.label}</div>
                <div className="product-empty-hint-desc">该产品后台正在建设中</div>
              </div>
            )}

            <Nav.Footer collapseButton={true}>
            </Nav.Footer>
          </Nav>
        </div>
      </Layout>
    </>
  );
};

export default SiderBar;
