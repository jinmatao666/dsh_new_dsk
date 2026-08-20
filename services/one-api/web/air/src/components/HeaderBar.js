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
import { Avatar, Dropdown, Layout, Nav, Switch } from '@douyinfe/semi-ui';
import { stringToColor } from '../helpers/render';

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
      {PRODUCTS.map((p) => {
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
            <Icon size={16} strokeWidth={1.75} />
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

  const [showSidebar, setShowSidebar] = useState(false);
  const [dark, setDark] = useState(false);
  const systemName = getSystemName();
  const logo = getLogo();
  var themeMode = localStorage.getItem('theme-mode');
  const currentDate = new Date();
  // enable fireworks on new year(1.1 and 2.9-2.24)
  const isNewYear = (currentDate.getMonth() === 0 && currentDate.getDate() === 1) || (currentDate.getMonth() === 1 && currentDate.getDate() >= 9 && currentDate.getDate() <= 24);

  async function logout() {
    setShowSidebar(false);
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
  return (
    <>
      <Layout>
        <div style={{ width: '100%' }}>
          <Nav
            mode={'horizontal'}
            // bodyStyle={{ height: 100 }}
            renderWrapper={({ itemElement, isSubNav, isInSubNav, props }) => {
              const routerMap = {
                about: '/about',
                login: '/login',
                register: '/register'
              };
              return (
                <Link
                  style={{ textDecoration: 'none' }}
                  to={routerMap[props.itemKey]}
                >
                  {itemElement}
                </Link>
              );
            }}
            selectedKeys={[]}
            // items={headerButtons}
            onSelect={key => {

            }}
            header={<ProductSwitcher />}
            footer={
              <>
                {isNewYear &&
                  // happy new year
                  <Dropdown
                    position="bottomRight"
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item onClick={handleNewYearClick}>Happy New Year!!!</Dropdown.Item>
                      </Dropdown.Menu>
                    }
                  >
                    <Nav.Item itemKey={'new-year'} text={'🏮'} />
                  </Dropdown>
                }
                <Nav.Item itemKey={'about'} icon={<IconHelpCircle />} />
                <Switch checkedText="🌞" size={'large'} checked={dark} uncheckedText="🌙" onChange={switchMode} />
                {userState.user ?
                  <>
                    <Dropdown
                      position="bottomRight"
                      render={
                        <Dropdown.Menu>
                          <Dropdown.Item onClick={logout}>退出</Dropdown.Item>
                        </Dropdown.Menu>
                      }
                    >
                      <Avatar size="small" color={stringToColor(userState.user.username)} style={{ margin: 4 }}>
                        {userState.user.username[0]}
                      </Avatar>
                      <span>{userState.user.username}</span>
                    </Dropdown>
                  </>
                  :
                  <>
                    <Nav.Item itemKey={'login'} text={'登录'} icon={<IconKey />} />
                    <Nav.Item itemKey={'register'} text={'注册'} icon={<IconUser />} />
                  </>
                }
              </>
            }
          >
          </Nav>
        </div>
      </Layout>
    </>
  );
};

export default HeaderBar;
