import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ClipboardList, Cpu, Home, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Users, UsersRound } from 'lucide-react';
import '../index.css';
import { API, isRoot } from '../helpers';

const items = [
  { label: '分析看板', path: '/', Icon: Home },
  { label: '模型配置', path: '/config/model', Icon: Cpu },
  { label: '技能管理', path: '/skill', Icon: Sparkles },
  { label: '专家管理', path: '/expert', Icon: UsersRound },
  { label: '用户权限', path: '/user', Icon: Users },
  { label: '模型日志', path: '/log', Icon: ClipboardList },
  { label: '账户设置', path: '/setting/personal', Icon: Settings }
];

export default function SiderBar({ isCollapsed, onCollapseChange }) {
  const location = useLocation();
  const selected = items.find((item) => item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path));
  const [pendingReviewCount, setPendingReviewCount] = useState(null);
  useEffect(() => {
    if (!isRoot()) return;
    const updateCount = event => setPendingReviewCount(Number(event.detail?.pending || 0));
    window.addEventListener('personal-skill-review-counts', updateCount);
    void API.get('/api/personal-skill/admin/reviews', { params: { page: 1, perPage: 1, status: 'pending' } })
      .then(response => setPendingReviewCount(Number(response.data?.totalItems || 0)))
      .catch(() => {});
    return () => window.removeEventListener('personal-skill-review-counts', updateCount);
  }, [location.pathname]);
  return <div className="zjugis-sidebar-inner">
    <div className="zjugis-sidebar-brand">{isCollapsed ? <img src="/brand-mark.svg" alt="万维 Buddy" /> : <img src="/brand-wordmark.svg" alt="万维 Buddy" />}</div>
    {!isCollapsed && <div className="zjugis-sidebar-caption">管理工作台</div>}
    <nav className="zjugis-sidebar-nav" aria-label="主导航">
      {items.map(({ label, path, Icon }) => <Link key={path} to={path} className={`zjugis-sidebar-item${selected?.path === path ? ' active' : ''}`} title={isCollapsed ? label : undefined}>
        <Icon className="zjugis-sidebar-item-icon" />{!isCollapsed && <span>{label}</span>}
        {path === '/skill' && pendingReviewCount !== null && pendingReviewCount > 0 && <span className="zjugis-sidebar-pending" aria-label={`${pendingReviewCount} 条待审核投稿`}>{isCollapsed ? (pendingReviewCount > 99 ? '99+' : pendingReviewCount) : `待审核 ${pendingReviewCount > 99 ? '99+' : pendingReviewCount}`}</span>}
      </Link>)}
    </nav>
    <button className="zjugis-sidebar-collapse" onClick={() => onCollapseChange(!isCollapsed)} title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}>
      {isCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />} {!isCollapsed && <span>收起侧边栏</span>}
    </button>
  </div>;
}
