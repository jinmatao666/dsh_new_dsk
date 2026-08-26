import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Grid, Chip,
  Dialog, DialogTitle, DialogContent, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  TextField, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import QRCode from 'qrcode';
import api from '../api';
import { NoticeDialog } from '../components/ActionDialog';

// 分 → 元
const yuan = (fen) => (fen / 100).toFixed(2);
const formatTime = (value) => (value ? new Date(value).toLocaleString() : '-');
const invoiceLabels = {
  NONE: '未开票',
  APPLYING: '申请中',
  ISSUED: '已开票',
  FAILED: '开票失败',
  CANCELED: '已取消',
};

export default function Recharge() {
  const points = (n) => Math.round(n || 0).toLocaleString();
  const [packages, setPackages] = useState([]);
  const [records, setRecords] = useState([]);
  const [discount, setDiscount] = useState(100);
  const [payType, setPayType] = useState('wechat');
  const [order, setOrder] = useState(null); // {order_no, code_url, amount}
  const [orderError, setOrderError] = useState(''); // 下单失败信息（如支付密钥未配置）
  const [pendingPkg, setPendingPkg] = useState(null); // 下单失败时仍在弹窗内展示套餐信息
  const [qrImage, setQrImage] = useState('');
  const [qrError, setQrError] = useState('');
  const [paid, setPaid] = useState(false);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_type: 'company',
    invoice_line: 'pc',
    buyer_name: '',
    buyer_tax_num: '',
    buyer_phone: '',
    email: '',
  });
  const [notice, setNotice] = useState('');
  const pollRef = React.useRef(null);

  const loadPackages = useCallback(() => {
    api.get('/recharge/packages').then((res) => {
      if (res.data.success) {
        setPackages(res.data.data.packages || []);
        setDiscount(res.data.data.discount || 100);
      }
    });
  }, []);

  const loadRecords = useCallback(() => {
    api.get('/recharge/records').then((res) => {
      if (res.data.success) setRecords(res.data.data || []);
    });
  }, []);

  useEffect(() => { loadPackages(); }, [loadPackages]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  // 渲染二维码
  useEffect(() => {
    let cancelled = false;
    setQrImage('');
    setQrError('');
    if (!order) return () => { cancelled = true; };
    if (!order.code_url) {
      setQrError('支付平台未返回二维码内容，请重新下单。');
      return () => { cancelled = true; };
    }
    QRCode.toDataURL(order.code_url, { width: 220, margin: 2 })
      .then((url) => {
        if (!cancelled) setQrImage(url);
      })
      .catch(() => {
        if (!cancelled) setQrError('二维码生成失败，请重新下单。');
      });
    return () => { cancelled = true; };
  }, [order]);

  // 轮询订单状态
  useEffect(() => {
    if (!order || paid) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/recharge/order?order_no=${order.order_no}`);
        if (res.data.success && res.data.data.status === 'paid') {
          setPaid(true);
          loadRecords();
          clearInterval(pollRef.current);
        }
      } catch (e) { /* 忽略轮询错误 */ }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [order, paid, loadRecords]);

  const handleRecharge = async (pkg) => {
    setPaid(false);
    setOrderError('');
    setPendingPkg(pkg); // 先打开弹窗，下单成功与否都展示结构
    setOrder(null);
    try {
      const res = await api.post('/recharge/order', { package_id: pkg.id, pay_type: payType });
      if (res.data.success) {
        setOrder(res.data.data);
      } else {
        setOrderError(res.data.message || '下单失败，请稍后重试。');
      }
    } catch (e) {
      setOrderError('下单失败，请检查网络后重试。');
    }
  };

  const closeDialog = () => {
    clearInterval(pollRef.current);
    setOrder(null);
    setPendingPkg(null);
    setOrderError('');
    setQrImage('');
    setQrError('');
    setPaid(false);
  };

  const openInvoiceDialog = (record) => {
    setInvoiceOrder(record);
    setInvoiceForm({
      invoice_type: 'company',
      invoice_line: 'pc',
      buyer_name: record.username || '',
      buyer_tax_num: '',
      buyer_phone: '',
      email: '',
    });
  };

  const submitInvoice = async () => {
    if (!invoiceOrder) return;
    try {
      const res = await api.post('/invoice/create', {
        ...invoiceForm,
        order_no: invoiceOrder.order_no,
      });
      if (res.data.success) {
        setNotice(res.data.message || '发票申请已提交');
        setInvoiceOrder(null);
        loadRecords();
      } else {
        setNotice(res.data.message || '发票申请失败');
      }
    } catch (e) {
      setNotice('发票申请失败');
    }
  };

  const renderInvoiceAction = (record) => {
    const status = record.invoice_status || 'NONE';
    if (status === 'ISSUED' && record.invoice_url) {
      return <Button size="small" variant="outlined" href={record.invoice_url} target="_blank">下载</Button>;
    }
    if (status === 'NONE' || status === 'FAILED' || status === '') {
      return <Button size="small" variant="outlined" onClick={() => openInvoiceDialog(record)}>开发票</Button>;
    }
    return <Chip size="small" label={invoiceLabels[status] || status} />;
  };

  const currentPayType = order?.pay_type || payType;
  const dialogAmount = order?.amount ?? pendingPkg?.discounted_price;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#1C1C1E' }}>企业充值</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {discount < 100 && (
            <Chip size="small" label={`企业折扣 ${discount / 10} 折`}
              sx={{ bgcolor: '#FFF4E5', color: '#FF9F0A', fontWeight: 600 }} />
          )}
          <Button size="small" variant={payType === 'wechat' ? 'contained' : 'outlined'}
            onClick={() => setPayType('wechat')}>微信</Button>
          <Button size="small" variant={payType === 'alipay' ? 'contained' : 'outlined'}
            onClick={() => setPayType('alipay')}>支付宝</Button>
        </Box>
      </Box>

      <Grid container spacing={2}>
        {packages.map((pkg) => {
          const discounted = pkg.discounted_price;
          const hasDiscount = discounted < pkg.price;
          return (
            <Grid item xs={12} sm={6} md={4} key={pkg.id}>
              <Card variant="outlined" sx={{
                borderRadius: '12px', borderColor: 'rgba(0,0,0,0.06)',
                transition: 'box-shadow 150ms', '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.08)' },
              }}>
                <CardContent>
                  {pkg.badge && (
                    <Chip size="small" label={pkg.badge}
                      sx={{ mb: 1, bgcolor: '#007AFF', color: '#fff', fontSize: 11 }} />
                  )}
                  <Typography sx={{ fontSize: 15, fontWeight: 600, color: '#1C1C1E', mb: 0.5 }}>{pkg.name}</Typography>
                  {pkg.description && (
                    <Typography sx={{ fontSize: 12, color: '#8E8E93', mb: 1.5, minHeight: 32 }}>{pkg.description}</Typography>
                  )}
                  <Typography sx={{ fontSize: 13, color: '#636366', mb: 1 }}>
                    到账 <strong style={{ color: '#34C759' }}>{points(pkg.point)}</strong> 积分
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 2 }}>
                    <Typography sx={{ fontSize: 24, fontWeight: 700, color: '#007AFF' }}>¥{yuan(discounted)}</Typography>
                    {hasDiscount && (
                      <Typography sx={{ fontSize: 14, color: '#C7C7CC', textDecoration: 'line-through' }}>¥{yuan(pkg.price)}</Typography>
                    )}
                  </Box>
                  <Button fullWidth variant="contained" onClick={() => handleRecharge(pkg)}
                    sx={{ borderRadius: '8px' }}>立即充值</Button>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
        {packages.length === 0 && (
          <Grid item xs={12}>
            <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 4, textAlign: 'center' }}>
              暂无可用充值套餐，请联系平台管理员配置。
            </Typography>
          </Grid>
        )}
      </Grid>

      <Box sx={{ mt: 4 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#636366', mb: 1 }}>充值记录</Typography>
        <TableContainer component={Paper} elevation={0}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>时间</TableCell>
                <TableCell>套餐</TableCell>
                <TableCell>订单号</TableCell>
                <TableCell>支付方式</TableCell>
                <TableCell align="right">金额</TableCell>
                <TableCell align="right">到账积分</TableCell>
                <TableCell align="right">充值后余额</TableCell>
                <TableCell align="right">发票</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id} sx={{ '&:hover': { bgcolor: '#FAFAFA' } }}>
                  <TableCell>
                    <Typography sx={{ fontSize: 12, color: '#636366' }}>{formatTime(record.created_at)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{record.package_name || record.remark || '-'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{record.order_no}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={record.pay_type === 'alipay' ? '支付宝' : '微信'} />
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontWeight: 600 }}>¥{yuan(record.amount || 0)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#34C759' }}>{points(record.quota)}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontSize: 12, fontFamily: 'monospace' }}>{points(record.after_quota)}</Typography>
                  </TableCell>
                  <TableCell align="right">{renderInvoiceAction(record)}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography sx={{ fontSize: 13, color: '#8E8E93', py: 3 }}>暂无充值记录</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Dialog open={!!order || !!pendingPkg} onClose={closeDialog} maxWidth="xs">
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
          {paid ? '充值成功' : '扫码支付'}
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 3, minWidth: 280 }}>
          {paid ? (
            <Box sx={{ py: 3 }}>
              <Typography sx={{ fontSize: 48, color: '#34C759', mb: 1 }}>✓</Typography>
              <Typography sx={{ fontSize: 14, color: '#1C1C1E' }}>积分已到账，可在概览查看余额</Typography>
              <Button variant="contained" sx={{ mt: 2 }} onClick={closeDialog}>完成</Button>
            </Box>
          ) : (
            <Box>
              {orderError ? (
                <Alert severity="error" sx={{ textAlign: 'left', mb: 2 }}>{orderError}</Alert>
              ) : qrError ? (
                <Alert severity="error" sx={{ textAlign: 'left', mb: 2 }}>{qrError}</Alert>
              ) : qrImage ? (
                <Box component="img" src={qrImage} alt="支付二维码"
                  sx={{ width: 220, height: 220, display: 'block', mx: 'auto' }} />
              ) : (
                <Box sx={{ width: 220, height: 220, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={24} />
                </Box>
              )}
              <Typography sx={{ fontSize: 13, color: '#636366', mt: 1 }}>
                请使用{currentPayType === 'alipay' ? '支付宝' : '微信'}扫码支付 ¥{dialogAmount != null ? yuan(dialogAmount) : ''}
              </Typography>
              {!orderError && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1.5, color: '#8E8E93' }}>
                  <CircularProgress size={14} />
                  <Typography sx={{ fontSize: 12 }}>等待支付中…</Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!invoiceOrder} onClose={() => setInvoiceOrder(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>申请发票</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 3 }}>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <Typography sx={{ fontSize: 13, color: '#636366' }}>
              订单 {invoiceOrder?.order_no}，金额 ¥{invoiceOrder ? yuan(invoiceOrder.amount) : ''}
            </Typography>
            <FormControl size="small" fullWidth>
              <InputLabel>抬头类型</InputLabel>
              <Select label="抬头类型" value={invoiceForm.invoice_type}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_type: e.target.value })}>
                <MenuItem value="company">企业</MenuItem>
                <MenuItem value="personal">个人</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>发票类型</InputLabel>
              <Select label="发票类型" value={invoiceForm.invoice_line}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_line: e.target.value })}>
                <MenuItem value="pc">电子普通发票</MenuItem>
                <MenuItem value="bs">增值税专用发票</MenuItem>
              </Select>
            </FormControl>
            <TextField size="small" label="发票抬头" value={invoiceForm.buyer_name}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, buyer_name: e.target.value })} fullWidth />
            <TextField size="small" label="纳税人识别号" value={invoiceForm.buyer_tax_num}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, buyer_tax_num: e.target.value })} fullWidth />
            <TextField size="small" label="手机号" value={invoiceForm.buyer_phone}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, buyer_phone: e.target.value })} fullWidth />
            <TextField size="small" label="接收邮箱" value={invoiceForm.email}
              onChange={(e) => setInvoiceForm({ ...invoiceForm, email: e.target.value })} fullWidth />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={() => setInvoiceOrder(null)}>取消</Button>
              <Button variant="contained" onClick={submitInvoice}>提交申请</Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
      <NoticeDialog open={!!notice} message={notice} onClose={() => setNotice('')} />
    </Box>
  );
}
