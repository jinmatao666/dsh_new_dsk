import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { unstable_HistoryRouter as HistoryRouter } from 'react-router-dom';
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
import { Layout } from '@douyinfe/semi-ui';
import SiderBar from './components/SiderBar';

initVChartSemiTheme({
  isWatchingThemeSwitch: true
});

const root = ReactDOM.createRoot(document.getElementById('root'));
const { Sider, Content, Header } = Layout;

root.render(
  <React.StrictMode>
    <StatusProvider>
      <UserProvider>
        <ProductProvider>
          <HistoryRouter history={history} basename={process.env.PUBLIC_URL}>
            <Layout style={{ height: '100vh', overflow: 'hidden' }}>
              <Sider>
                <SiderBar />
              </Sider>
              <Layout style={{ height: '100vh', overflow: 'hidden' }}>
                <Header>
                  <HeaderBar />
                </Header>
                <Content
                  style={{
                    padding: '24px',
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto'
                  }}
                >
                  <App />
                </Content>
              </Layout>
              <ToastContainer />
            </Layout>
          </HistoryRouter>
        </ProductProvider>
      </UserProvider>
    </StatusProvider>
  </React.StrictMode>
);
