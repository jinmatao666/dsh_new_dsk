import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, TextField, Button, Typography, Alert } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/login', { username, password });
      if (res.data.success) {
        login(res.data.data.token, res.data.data.org_name);
        navigate('/dashboard');
      } else {
        setError(res.data.message);
      }
    } catch {
      setError('网络错误，请稍后重试');
    }
    setLoading(false);
  };

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: '#F5F5F7',
    }}>
      <Box sx={{
        width: 380, p: 4, borderRadius: '12px', bgcolor: '#FFFFFF',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
      }}>
        <Typography sx={{ fontSize: 20, fontWeight: 600, color: '#1C1C1E', textAlign: 'center', mb: 0.5 }}>
          企业管理后台
        </Typography>
        <Typography sx={{ fontSize: 13, color: '#8E8E93', textAlign: 'center', mb: 3 }}>
          登录以管理您的企业
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2, fontSize: 13 }}>{error}</Alert>}
        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth label="企业用户名" value={username} size="small"
            onChange={(e) => setUsername(e.target.value)}
            sx={{ mb: 2 }} autoFocus
          />
          <TextField
            fullWidth label="密码" type="password" value={password} size="small"
            onChange={(e) => setPassword(e.target.value)}
            sx={{ mb: 3 }}
          />
          <Button fullWidth variant="contained" type="submit" disabled={loading}
            sx={{ py: 1, fontSize: 14, fontWeight: 600 }}>
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>
      </Box>
    </Box>
  );
}
