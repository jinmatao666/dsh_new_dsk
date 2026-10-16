import React, {useEffect, useState} from 'react';
import {API, showError} from '../../helpers';
import {renderQuota} from '../../helpers/render';
import {Layout, Typography, Card, Divider} from "@douyinfe/semi-ui";

const { Title, Text } = Typography;

const TopUp = () => {
    const [orgInfo, setOrgInfo] = useState(null);

    useEffect(() => {
        const loadOrgInfo = async () => {
            let res = await API.get(`/api/user/self`);
            const {success, message, org_info} = res.data;
            if (success && org_info) {
                setOrgInfo(org_info);
            } else if (!success) {
                showError(message);
            }
        };
        loadOrgInfo();
    }, []);

    return (
        <div>
            <Layout>
                <Layout.Header>
                    <h3>充值额度</h3>
                </Layout.Header>
                <Layout.Content>
                    <div style={{marginTop: 20, display: 'flex', justifyContent: 'center'}}>
                        <Card style={{width: '500px', padding: '20px', textAlign: 'center'}}>
                            {orgInfo ? (
                                <>
                                    <Title level={3}>所属企业：{orgInfo.org_name}</Title>
                                    <div style={{marginTop: 16, marginBottom: 16}}>
                                        <Text style={{fontSize: 16, color: '#666'}}>
                                            剩余积分：{orgInfo.quota_limit === -1 ? '不限' : renderQuota(orgInfo.quota_limit - orgInfo.used_quota)}
                                        </Text>
                                    </div>
                                    <div style={{marginTop: 16, marginBottom: 16}}>
                                        <Text style={{fontSize: 16, color: '#666'}}>
                                            已用额度：{renderQuota(orgInfo.used_quota)}
                                        </Text>
                                    </div>
                                </>
                            ) : (
                                <Title level={3}>加载中...</Title>
                            )}
                            <Divider />
                            <Text type="tertiary" style={{fontSize: 14}}>
                                您当前为企业用户，充值请联系企业管理员
                            </Text>
                        </Card>
                    </div>
                </Layout.Content>
            </Layout>
        </div>
    );
};

export default TopUp;
