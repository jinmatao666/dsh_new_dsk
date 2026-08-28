import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ClipboardList, Cpu, Home, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Users } from 'lucide-react';
import '../index.css';

const items = [
  { label: '分析看板', path: '/', Icon: Home },
  { label: '模型配置', path: '/config/model', Icon: Cpu },
  { label: '技能管理', path: '/skill', Icon: Sparkles },
  { label: '用户管理', path: '/user', Icon: Users },
  { label: '模型日志', path: '/log', Icon: ClipboardList },
  { label: '账户设置', path: '/setting/personal', Icon: Settings }
];

export default function SiderBar({ isCollapsed, onCollapseChange }) {
  const location = useLocation();
  const selected = items.find((item) => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path));
  return <div className="zjugis-sidebar-inner">
    <div className="zjugis-sidebar-brand">{isCollapsed ? <img src="/zjugis-mark.png" alt="ZJUGIS" /> : <img src="/zjugis-logo.png" alt="ZJUGIS Harness" />}</div>
    {!isCollapsed && <div className="zjugis-sidebar-caption">管理工作台</div>}
    <nav className="zjugis-sidebar-nav" aria-label="主导航">
      {items.map(({ label, path, Icon }) => <Link key={path} to={path} className={`zjugis-sidebar-item${selected?.path === path ? ' active' : ''}`} title={isCollapsed ? label : undefined}>
        <Icon className="zjugis-sidebar-item-icon" />{!isCollapsed && <span>{label}</span>}
      </Link>)}
    </nav>
    <button className="zjugis-sidebar-collapse" onClick={() => onCollapseChange(!isCollapsed)} title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}>
      {isCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />} {!isCollapsed && <span>收起侧边栏</span>}
    </button>
  </div>;
}
