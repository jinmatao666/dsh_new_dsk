import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';

export function NoticeDialog({ open, message, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>提示</DialogTitle>
      <DialogContent sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</DialogContent>
      <DialogActions><Button variant="contained" onClick={onClose}>确定</Button></DialogActions>
    </Dialog>
  );
}

export function ConfirmDialog({ open, title = '请确认操作', message, onCancel, onConfirm }) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>确定</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PasswordDialog({ open, onCancel, onConfirm, value, onChange, label = '管理员密码' }) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>请输入管理员密码</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth size="small" type="password" label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" onClick={onConfirm}>确定</Button>
      </DialogActions>
    </Dialog>
  );
}
