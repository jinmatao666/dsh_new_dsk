import React from 'react';
import RechargePackagesTable from '../../components/RechargePackagesTable';
import { Layout } from '@douyinfe/semi-ui';

const RechargePackage = () => (
  <>
    <Layout>
      <Layout.Content>
        <RechargePackagesTable />
      </Layout.Content>
    </Layout>
  </>
);

export default RechargePackage;
