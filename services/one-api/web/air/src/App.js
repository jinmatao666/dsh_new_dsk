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
import SkillTest from './pages/SkillTest';
import Expert from './pages/Expert';
import KnowledgeLibrary from './pages/Knowledge';
import Usage from './pages/Usage';
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
import VersionRelease, { LegacyVersionRelease } from './pages/VersionRelease';
import OperationDashboard from './pages/OperationDashboard';
import ProductManagement from './pages/ProductManagement';
import OrderManagement from './pages/OrderManagement';
import EditProduct from './pages/ProductManagement/EditProduct';
import PersonalSettingPage from './pages/PersonalSetting';
import SystemSettingPage from './pages/SystemSetting';
import AdminPermissions from './pages/AdminPermissions';
import Toolbox from './pages/Toolbox';
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
    let user = localStorage.getItem('user');
    if (user) {
      let data = JSON.parse(user);
      userDispatch({ type: 'login', payload: data });
    }
  };

  useEffect(() => {
    loadUser();
    document.title = '万维Buddy';
  }, []);

  return (
    <Routes>
          <Route
            path="/"
            element={
              <Suspense fallback={<Loading></Loading>}><Home /></Suspense>
            }
          />
          <Route
            path="/channel"
            element={
              <PrivateRoute>
                <ZjugisModelConfigPage />
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
                <ZjugisUsersPage />
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
                <AdminPermissions />
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
            path="/usage"
            element={<PrivateRoute><Usage /></PrivateRoute>}
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
                <Organization />
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
                <ParvisDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products"
            element={
              <PrivateRoute>
                <ProductManagement />
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products/new"
            element={
              <PrivateRoute>
                <EditProduct />
              </PrivateRoute>
            }
          />
          <Route
            path="/transaction/products/:id"
            element={
              <PrivateRoute>
                <EditProduct />
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
                <OrderManagement />
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
                <Skill />
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
            path="/expert"
            element={
              <PrivateRoute>
                <Expert />
              </PrivateRoute>
            }
          />
          <Route path="/skill/experts" element={<Navigate to="/expert" replace />} />
          <Route
            path="/knowledge"
            element={<PrivateRoute><KnowledgeLibrary /></PrivateRoute>}
          />
          <Route
            path="/skill/reviews"
            element={
              <PrivateRoute>
                <Skill />
              </PrivateRoute>
            }
          />
          <Route path="/skill/reviews/:id/test" element={<PrivateRoute><RootRoute><SkillTest /></RootRoute></PrivateRoute>} />
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
                <ZjugisModelConfigPage />
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
                <OperationDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/activity"
            element={
              <PrivateRoute>
                <ActivityConfig />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/influencer-code"
            element={
              <PrivateRoute>
                <InfluencerCode />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/user-crowd"
            element={
              <PrivateRoute>
                <UserCrowdConfig />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/user"
            element={
              <PrivateRoute>
                <UserOperation />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/message"
            element={
              <PrivateRoute>
                <MessageNotification />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/notification"
            element={
              <PrivateRoute>
                <NotificationManage />
              </PrivateRoute>
            }
          />
          <Route
            path="/operation/version-release"
            element={
              <PrivateRoute>
                <VersionRelease />
              </PrivateRoute>
            }
          />
          <Route path="/operation/version-release/legacy" element={<PrivateRoute><LegacyVersionRelease /></PrivateRoute>} />
          <Route
            path="/monitor-board"
            element={
              <PrivateRoute>
                <MonitorBoard />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin-operation-log"
            element={
              <PrivateRoute>
                <AdminOperationLog />
              </PrivateRoute>
            }
          />
          <Route
            path="/feedback"
            element={
              <PrivateRoute>
                <Feedback />
              </PrivateRoute>
            }
          />
          <Route
            path="/data-board/custom"
            element={
              <PrivateRoute>
                <DataCustom />
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
