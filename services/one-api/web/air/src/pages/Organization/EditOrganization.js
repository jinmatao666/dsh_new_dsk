import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../helpers';

const { Title } = Typography;

const EditOrganization = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values) => {
    if (!values.name) { showError('企业名称不能为空'); return; }
    if (!values.login_username) { showError('企业登录用户名不能为空'); return; }
    if (!values.login_password) { showError('企业登录密码不能为空'); return; }
    setLoading(true);
    const res = await API.post('/api/organization/create', {
      ...values,
      max_members: Number(values.max_members || 50),
    });
    const { success, message, data } = res.data;
    if (success) {
      showSuccess('创建成功');
      navigate(`/organization/${data.id}`);
    } else {
      showError(message);
    }
    setLoading(false);
  };

  return (
    <div>
      <Title heading={4} style={{ marginBottom: 16 }}>创建企业</Title>
      <Form onSubmit={handleSubmit} style={{ maxWidth: 500 }}>
        <Form.Input field="name" label="企业名称" placeholder="输入企业名称" rules={[{ required: true }]} />
        <Form.Input field="login_username" label="企业登录用户名" placeholder="企业在3001端口登录的用户名" rules={[{ required: true }]} />
        <Form.Input field="login_password" label="企业登录密码" placeholder="企业在3001端口登录的密码" mode="password" rules={[{ required: true }]} />
        <Form.Input field="code" label="企业编码" placeholder="可选，不填自动生成" />
        <Form.Input field="group" label="计费分组" placeholder="default" initValue="default" />
        <Form.InputNumber field="max_members" label="最大成员数" initValue={50} />
        <Form.Input field="billing_email" label="财务邮箱" placeholder="可选" />
        <Form.Input field="tax_num" label="企业税号" placeholder="可选，用于开票" />
        <Button theme="solid" htmlType="submit" loading={loading}>创建</Button>
      </Form>
    </div>
  );
};

export default EditOrganization;
