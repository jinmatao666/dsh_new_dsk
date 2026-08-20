import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  AccountTree as AccountTreeIcon,
  BarChart as BarChartIcon,
  AccountBalanceWallet as WalletIcon,
  ReceiptLong as ReceiptLongIcon,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const drawerWidth = 240;

const menuItems = [
  { text: '概览', icon: <DashboardIcon sx={{ fontSize: 20 }} />, path: '/dashboard' },
  { text: '成员管理', icon: <PeopleIcon sx={{ fontSize: 20 }} />, path: '/members' },
  { text: '部门管理', icon: <AccountTreeIcon sx={{ fontSize: 20 }} />, path: '/departments' },
  { text: '用量统计', icon: <BarChartIcon sx={{ fontSize: 20 }} />, path: '/usage' },
  { text: '操作审计', icon: <HistoryIcon sx={{ fontSize: 20 }} />, path: '/audit-logs' },
  { text: '充值', icon: <WalletIcon sx={{ fontSize: 20 }} />, path: '/recharge' },
  { text: '额度账本', icon: <ReceiptLongIcon sx={{ fontSize: 20 }} />, path: '/ledger' },
  { text: '企业设置', icon: <SettingsIcon sx={{ fontSize: 20 }} />, path: '/settings' },
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgName, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          bgcolor: '#F5F5F7',
          borderRight: '1px solid rgba(0,0,0,0.06)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ px: 2.5, py: 2.5 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E', lineHeight: 1.3 }}>
            {orgName || '企业管理'}
          </Typography>
          <Typography sx={{ fontSize: 11, color: '#8E8E93', mt: 0.5 }}>
            管理后台
          </Typography>
        </Box>

        <List sx={{ px: 1, flex: 1 }}>
          {menuItems.map((item) => {
            const selected = location.pathname === item.path;
            return (
              <ListItemButton
                key={item.path}
                onClick={() => navigate(item.path)}
                sx={{
                  borderRadius: '8px',
                  mb: 0.5,
                  py: 0.8,
                  px: 1.5,
                  minHeight: 36,
                  bgcolor: selected ? 'rgba(0,122,255,0.1)' : 'transparent',
                  '&:hover': {
                    bgcolor: selected ? 'rgba(0,122,255,0.12)' : 'rgba(0,0,0,0.04)',
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: selected ? '#007AFF' : '#8E8E93' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: 13,
                    fontWeight: selected ? 600 : 500,
                    color: selected ? '#007AFF' : '#3A3A3C',
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>

        <Box sx={{ px: 1, pb: 2 }}>
          <ListItemButton
            onClick={handleLogout}
            sx={{
              borderRadius: '8px',
              py: 0.8,
              px: 1.5,
              minHeight: 36,
              '&:hover': { bgcolor: 'rgba(255,59,48,0.08)' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 32, color: '#8E8E93' }}>
              <LogoutIcon sx={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText
              primary="退出登录"
              primaryTypographyProps={{ fontSize: 13, fontWeight: 500, color: '#8E8E93' }}
            />
          </ListItemButton>
        </Box>
      </Box>

      <Box component="main" sx={{ flex: 1, bgcolor: '#FFFFFF', p: 3, overflow: 'auto' }}>
        <Outlet />
      </Box>
    </Box>
  );
}
