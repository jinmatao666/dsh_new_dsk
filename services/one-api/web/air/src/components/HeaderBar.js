import React, { useContext, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserContext } from '../context/User';
import {
  ProductContext,
  PRODUCTS,
  getProductLanding,
  productForPath,
  writeProductPath
} from '../context/Product';

import { API, getLogo, getSystemName, showSuccess } from '../helpers';
import '../index.css';

import fireworks from 'react-fireworks';

import { IconHelpCircle, IconKey, IconUser } from '@douyinfe/semi-icons';
import { Switch } from '@douyinfe/semi-ui';

// 顶部产品切换器：在不同产品后台之间横向切换。
// 切换时跳转到目标产品的落地页（优先上次访问，其次默认首页），
// 并随路由变化记录各产品的最后访问路径、同步高亮的 Tab。
const ProductSwitcher = () => {
  const { activeProduct, setActiveProduct } = useContext(ProductContext);
  const navigate = useNavigate();
  const location = useLocation();

  // 路由变化时：记录当前路径归属的产品，并保持高亮 Tab 与之一致。
  useEffect(() => {
    const owner = productForPath(location.pathname);
    writeProductPath(owner, location.pathname + location.search);
    if (owner !== activeProduct) {
      setActiveProduct(owner);
    }
  }, [location.pathname, location.search]);

  const handleSwitch = (key) => {
    if (key === activeProduct) return;
    setActiveProduct(key);
    navigate(getProductLanding(key));
  };

  return (
    <div className="product-switcher">
      {PRODUCTS.filter((p) => !p.placeholder).map((p) => {
        const Icon = p.icon;
        const selected = p.key === activeProduct;
        return (
          <button
            key={p.key}
            type="button"
            className={`product-switcher-tab${selected ? ' product-switcher-tab-active' : ''}`}
            onClick={() => handleSwitch(p.key)}
            aria-pressed={selected}
            aria-label={p.label}
          >
            {p.key === 'parvis' ? (
              <img className="product-switcher-mark" src="/zjugis-mark.png" alt="" />
            ) : (
              <Icon size={16} strokeWidth={1.75} />
            )}
            <span className="product-switcher-label">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
};

// HeaderBar Buttons
let headerButtons = [
  {
    text: '关于',
    itemKey: 'about',
    to: '/about',
    icon: <IconHelpCircle />
  }
];

if (localStorage.getItem('chat_link')) {
  headerButtons.splice(1, 0, {
    name: '聊天',
    to: '/chat',
    icon: 'comments'
  });
}

const HeaderBar = () => {
  const [userState, userDispatch] = useContext(UserContext);
  let navigate = useNavigate();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const systemName = getSystemName();
  const logo = getLogo();
  var themeMode = localStorage.getItem('theme-mode');
  const currentDate = new Date();
  // enable fireworks on new year(1.1 and 2.9-2.24)
  const isNewYear = (currentDate.getMonth() === 0 && currentDate.getDate() === 1) || (currentDate.getMonth() === 1 && currentDate.getDate() >= 9 && currentDate.getDate() <= 24);

  async function logout() {
    setUserMenuOpen(false);
    await API.get('/api/user/logout');
    showSuccess('注销成功!');
    userDispatch({ type: 'logout' });
    localStorage.removeItem('user');
    navigate('/login');
  }

  const handleNewYearClick = () => {
    fireworks.init('root', {});
    fireworks.start();
    setTimeout(() => {
      fireworks.stop();
      setTimeout(() => {
        window.location.reload();
      }, 10000);
    }, 3000);
  };

  useEffect(() => {
    if (themeMode === 'dark') {
      switchMode(true);
    }
    if (isNewYear) {
      console.log('Happy New Year!');
    }
  }, []);

  const switchMode = (model) => {
    const body = document.body;
    if (!model) {
      body.removeAttribute('theme-mode');
      localStorage.setItem('theme-mode', 'light');
    } else {
      body.setAttribute('theme-mode', 'dark');
      localStorage.setItem('theme-mode', 'dark');
    }
    setDark(model);
  };
  return <div className="zjugis-topbar">
    <ProductSwitcher />
    <div className="zjugis-topbar-actions">
      <button className="zjugis-topbar-icon" title="帮助"><IconHelpCircle /></button>
      <Switch checkedText="🌞" size="large" checked={dark} uncheckedText="🌙" onChange={switchMode} />
      {userState.user ? <div className="zjugis-user-menu"><button className="zjugis-user-chip" onClick={() => setUserMenuOpen((open) => !open)}><span className="zjugis-user-avatar">{userState.user.username[0].toUpperCase()}</span><span>{userState.user.username}</span><span className="zjugis-user-chevron">⌄</span></button>{userMenuOpen && <div className="zjugis-user-popover"><div className="zjugis-user-popover-name">{userState.user.username}</div><button onClick={logout}>退出登录</button></div>}</div> : <><Link className="zjugis-topbar-link" to="/login"><IconKey /> 登录</Link><Link className="zjugis-topbar-link" to="/register"><IconUser /> 注册</Link></>}
    </div>
  </div>;
};

export default HeaderBar;
