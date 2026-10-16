import React from 'react';
import LogsTable from '../../components/LogsTable';
import AdminPageFrame from '../../components/AdminPageFrame';

const Token = () => (
  <AdminPageFrame
    kicker="MODEL OBSERVABILITY"
    title="模型日志"
    description="查看模型调用、耗时、Token 消耗和失败记录。"
  >
    <LogsTable />
  </AdminPageFrame>
);

export default Token;
