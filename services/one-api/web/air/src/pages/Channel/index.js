import React from 'react';
import ChannelsTable from '../../components/ChannelsTable';
import AdminPageFrame from '../../components/AdminPageFrame';

const File = () => (
    <AdminPageFrame
        kicker="MODEL CENTER"
        title="模型配置"
        description="管理渠道、模型和默认调用参数。"
    >
        <ChannelsTable />
    </AdminPageFrame>
);

export default File;
