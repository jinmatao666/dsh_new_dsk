import React, { useEffect, useState } from 'react';
import { Box, Typography, TextField, Button, Alert } from '@mui/material';
import api from '../api';

export default function Settings() {
  const [form, setForm] = useState({ name: '', billing_email: '', tax_num: '' });
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings').then((res) => {
      if (res.data.success) {
        const d = res.data.data;
        setForm({ name: d.name, billing_email: d.billing_email || '', tax_num: d.tax_num || '' });
        setInfo(d);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    const res = await api.put('/settings', form);
    if (res.data.success) {
      setMsg('保存成功');
      setTimeout(() => setMsg(''), 3000);
    } else {
      setMsg(res.data.message);
    }
  };

  if (loading) return null;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E', mb: 2.5 }}>企业设置</Typography>
      {msg && <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>{msg}</Alert>}

      <Box sx={{
        maxWidth: 520, p: 3, borderRadius: '10px', border: '1px solid rgba(0,0,0,0.06)',
        bgcolor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        {info && (
          <Box sx={{ display: 'flex', gap: 3, mb: 2.5, pb: 2, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <Box>
              <Typography sx={{ fontSize: 11, color: '#8E8E93', mb: 0.3 }}>企业编码</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 500, fontFamily: 'monospace' }}>{info.code}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, color: '#8E8E93', mb: 0.3 }}>成员上限</Typography>
              <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{info.max_members}</Typography>
            </Box>
          </Box>
        )}
        <TextField fullWidth label="企业名称" size="small" value={form.name}
          onChange={(e) => setForm({...form, name: e.target.value})} sx={{ mb: 2 }} />
        <TextField fullWidth label="财务联系邮箱" size="small" value={form.billing_email}
          onChange={(e) => setForm({...form, billing_email: e.target.value})} sx={{ mb: 2 }} />
        <TextField fullWidth label="企业税号" size="small" value={form.tax_num}
          onChange={(e) => setForm({...form, tax_num: e.target.value})} sx={{ mb: 3 }} />
        <Button variant="contained" onClick={handleSave} sx={{ px: 3 }}>保存</Button>
      </Box>
    </Box>
  );
}
