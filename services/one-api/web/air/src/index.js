import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { unstable_HistoryRouter as HistoryRouter, useLocation } from 'react-router-dom';
import history from './history';
import App from './App';
import HeaderBar from './components/HeaderBar';
import 'semantic-ui-css/semantic.min.css';
import './index.css';
import { UserProvider } from './context/User';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { StatusProvider } from './context/Status';
import { ProductProvider } from './context/Product';
import SiderBar from './components/SiderBar';
import { isMobile } from './helpers';

initVChartSemiTheme({
  isWatchingThemeSwitch: true
});

const root = ReactDOM.createRoot(document.getElementById('root'));

const AUTH_PATHS = new Set(['/login', '/register', '/reset', '/user/reset']);

function AdminShell() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => (
    isMobile() || localStorage.getItem('default_collapse_sidebar') === 'true'
  ));
  if (AUTH_PATHS.has(location.pathname)) {
    return (
      <main className="wanwei-auth-shell">
        <App />
      </main>
    );
  }
  return (
    <div className={`zjugis-admin-shell ${sidebarCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <aside className="zjugis-sidebar"><SiderBar isCollapsed={sidebarCollapsed} onCollapseChange={setSidebarCollapsed} /></aside>
      <div className="zjugis-workspace">
        <header className="zjugis-header"><HeaderBar /></header>
        <main className="zjugis-content"><App /></main>
      </div>
    </div>
  );
}

root.render(
  <React.StrictMode>
    <StatusProvider>
      <UserProvider>
        <ProductProvider>
          <HistoryRouter history={history} basename={process.env.PUBLIC_URL}>
            <AdminShell />
            <>
              <ToastContainer />
            </>
          </HistoryRouter>
        </ProductProvider>
      </UserProvider>
    </StatusProvider>
  </React.StrictMode>
);
