import React, { lazy, Suspense, useContext, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Loading from './components/Loading';
import User from './pages/User';
import { PrivateRoute } from './components/PrivateRoute';
import RegisterForm from './components/RegisterForm';
import LoginForm from './components/LoginForm';
import NotFound from './pages/NotFound';
import Setting from './pages/Setting';
import EditUser from './pages/User/EditUser';
import { isRoot } from './helpers';
import PasswordResetForm from './components/PasswordResetForm';
import GitHubOAuth from './components/GitHubOAuth';
import PasswordResetConfirm from './components/PasswordResetConfirm';
import { UserContext } from './context/User';
import Channel from './pages/Channel';
import EditChannel from './pages/Channel/EditChannel';
import Log from './pages/Log';
import Chat from './pages/Chat';
import AddUser from './pages/User/AddUser';
import Midjourney from './pages/Midjourney';
import Detail from './pages/Detail';
import Dashboard from './pages/Dashboard';
import Organization from './pages/Organization';
import EditOrganization from './pages/Organization/EditOrganization';
import OrgMembers from './pages/Organization/OrgMembers';
import ParvisDashboard from './pages/ParvisDashboard';
import Skill from './pages/Skill';
import Config from './pages/Config';
import ModelConfigPage from './pages/ModelConfig';
import MonitorBoard from './pages/MonitorBoard';
import AdminOperationLog from './pages/AdminOperationLog';
import Feedback from './pages/Feedback';
import DataCustom from './pages/DataBoard/Custom';
import ComingSoon from './pages/ComingSoon';
import ActivityConfig from './pages/ActivityConfig';
import UserCrowdConfig from './pages/UserCrowdConfig';
import UserOperation from './pages/UserOperation';
import InfluencerCode from './pages/InfluencerCode';
import MessageNotification from './pages/MessageNotification';
import NotificationManage from './pages/NotificationManage';
import VersionRelease from './pages/VersionRelease';
import OperationDashboard from './pages/OperationDashboard';
import ProductManagement from './pages/ProductManagement';
import OrderManagement from './pages/OrderManagement';
import EditProduct from './pages/ProductManagement/EditProduct';
import PersonalSettingPage from './pages/PersonalSetting';
import SystemSettingPage from './pages/SystemSetting';
import AdminPermissions from './pages/AdminPermissions';
import Toolbox from './pages/Toolbox';
import PermissionGuard from './components/PermissionGuard';
import { ModelConfigPage as ZjugisModelConfigPage, UsersPage as ZjugisUsersPage, LogsPage as ZjugisLogsPage, AccountPage as ZjugisAccountPage } from './pages/Zjugis';

const LarkOAuth = lazy(() => import('./components/LarkOAuth'));

const Home = lazy(() => import('./pages/Home'));
const About = lazy(() => import('./pages/About'));

const RootRoute = ({ children }) => {
  if (!isRoot()) {
    return <NotFound />;
  }
  return children;
};

function App() {
  const [, userDispatch] = useContext(UserContext);
  // const [statusState, statusDispatch] = useContext(StatusContext);

  const loadUser = () => {
    // DEV bypass: inject a role=100 root mock user when no login state exists,
    // so private routes and PermissionGuard render during local UI debugging.
    // Remove or gate by env var before production builds.
    if (import.meta.env.DEV && !localStorage.getItem('user')) {
      const mockUser = {
        id: 1,
        username: 'root',
        role: 100,
        admin_permissions: '[]',
        status: 1,
        quota: 1000000,
        used_quota: 0,
        request_count: 0,
      };
      localStorage.setItem('user', JSON.stringify(mockUser));
    }
    let user = localStorage.getItem('user');
    if (user) {
      let data = JSON.parse(user);
      userDispatch({ type: 'login', payload: data });
    }
  };

  useEffect(() => {
    loadUser();
    document.title = 'ZJUGIS Harness';
  }, []);

  return (
    <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <Home />
              </Suspense>
            }
          />
          <Route
            path="/channel"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="channel"><ZjugisModelConfigPage /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/channel/edit/:id"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <EditChannel />
              </Suspense>
            }
          />
          <Route
            path="/channel/add"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <EditChannel />
              </Suspense>
            }
          />
          <Route
            path="/user"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="user"><ZjugisUsersPage /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/user/edit/:id"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <EditUser />
              </Suspense>
            }
          />
          <Route
            path="/user/edit"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <EditUser />
              </Suspense>
            }
          />
          <Route
            path="/user/add"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <AddUser />
              </Suspense>
            }
          />
          <Route
            path="/user/reset"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <PasswordResetConfirm />
              </Suspense>
            }
          />
          <Route
            path="/login"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <LoginForm />
              </Suspense>
            }
          />
          <Route
            path="/register"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <RegisterForm />
              </Suspense>
            }
          />
          <Route
            path="/reset"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <PasswordResetForm />
              </Suspense>
            }
          />
          <Route
            path="/oauth/github"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <GitHubOAuth />
              </Suspense>
            }
          />
          <Route
            path="/oauth/lark"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <LarkOAuth />
              </Suspense>
            }
          />
          <Route
            path="/setting"
            element={<Navigate to="/setting/personal" replace />}
          />
          <Route
            path="/setting/personal"
            element={
              <PrivateRoute>
                <ZjugisAccountPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/setting/system"
            element={
              <PrivateRoute>
                <SystemSettingPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/setting/admin-permissions"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="admin_permissions"><AdminPermissions /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/setting/toolbox"
            element={
              <PrivateRoute>
                <Toolbox />
              </PrivateRoute>
            }
          />
          <Route
            path="/log"
            element={
              <PrivateRoute>
                <ZjugisLogsPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/detail"
            element={
              <PrivateRoute>
                <Detail />
              </PrivateRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/midjourney"
            element={
              <PrivateRoute>
                <Midjourney />
              </PrivateRoute>
            }
          />
          <Route
            path="/about"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <About />
              </Suspense>
            }
          />
          <Route
            path="/chat"
            element={
              <Suspense fallback={<Loading></Loading>}>
                <Chat />
              </Suspense>
            }
          />
          <Route
            path="/organization"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="organization"><Organization /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/create"
            element={
              <PrivateRoute>
                <EditOrganization />
              </PrivateRoute>
            }
          />
          <Route
            path="/organization/:id"
            element={
              <PrivateRoute>
                <OrgMembers />
              </PrivateRoute>
            }
          />
          <Route
            path="/parvis-dashboard"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="parvis_dashboard"><ParvisDashboard /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="product"><ProductManagement /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products/new"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="product"><EditProduct /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products/:id"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="product"><EditProduct /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/member-identities"
            element={<Navigate to="/transaction/products" replace />}
          />
          <Route
            path="/transaction/orders"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="order"><OrderManagement /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/invoices"
            element={<Navigate to="/transaction/orders" replace />}
          />
          <Route
            path="/recharge-packages"
            element={<Navigate to="/transaction/products" replace />}
          />
          <Route
            path="/skill"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="skill"><Skill /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/skill/categories"
            element={
              <PrivateRoute>
                <Skill />
              </PrivateRoute>
            }
          />
          <Route
            path="/config"
            element={
              <PrivateRoute>
                <Config />
              </PrivateRoute>
            }
          />
          <Route
            path="/config/model"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="model_config"><ZjugisModelConfigPage /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/config/quota"
            element={
              <PrivateRoute>
                <Navigate to="/operation/activity" replace />
              </PrivateRoute>
            }
          />
          <Route
            path="/config/recharge-package"
            element={
              <PrivateRoute>
                <Navigate to="/transaction/products" replace />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/dashboard"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="operation_dashboard"><OperationDashboard /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/activity"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="activity"><ActivityConfig /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/influencer-code"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="activity"><InfluencerCode /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/user-crowd"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="activity"><UserCrowdConfig /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/user"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="user_operation"><UserOperation /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/message"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="message_notification"><MessageNotification /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/notification"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="message_notification"><NotificationManage /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/version-release"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="version_note"><VersionRelease /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/monitor-board"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="monitor_board"><MonitorBoard /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/admin-operation-log"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="admin_operation_log"><AdminOperationLog /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/feedback"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="feedback"><Feedback /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/data-board/custom"
            element={
              <PrivateRoute>
                <PermissionGuard permKey="custom_board"><DataCustom /></PermissionGuard>
              </PrivateRoute>
            }
          />
          <Route
            path="/coming-soon"
            element={
              <PrivateRoute>
                <ComingSoon />
              </PrivateRoute>
            }
          />
          <Route path="*" element={
            <NotFound />
          } />
    </Routes>
  );
}

export default App;
