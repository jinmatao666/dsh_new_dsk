import React, { useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Select, Spin, Button, Input, Modal, Typography, Toast, Space, Checkbox } from '@douyinfe/semi-ui';
import VChart from '@visactor/vchart';
import { API, showError, showSuccess } from '../../helpers';
import { Save, Trash2 } from 'lucide-react';

const { Title, Text } = Typography;

const cardStyle = {
  borderRadius: 10,
  border: 'none',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

const OperationDashboard = () => {
  const [loading, setLoading] = useState(false);
  const [dimension, setDimension] = useState('activity'); // activity / crowd
  const [targetId, setTargetId] = useState(null);
  const [period, setPeriod] = useState('7d');
  const [stats, setStats] = useState(null);

  // 下拉列表数据
  const [activities, setActivities] = useState([]);
  const [crowds, setCrowds] = useState([]);

  // 保存的看板列表
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboard, setSelectedDashboard] = useState(null);

  // 保存看板对话框
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [dashboardName, setDashboardName] = useState('');

  // 指标分组选择
  const [selectedMetrics, setSelectedMetrics] = useState(['quota_health']);

  const trendChartRef = useRef(null);
  const trendInstanceRef = useRef(null);

  const quotaPerUnit = parseFloat(localStorage.getItem('quota_per_unit') || '1000');

  // 加载活动列表
  const fetchActivities = async () => {
    try {
      const res = await API.get('/api/activity/');
      if (res.data.success) {
        setActivities((res.data.data || []).map(a => ({ value: a.id, label: a.name })));
      }
    } catch (e) {
      showError('加载活动列表失败: ' + e.message);
    }
  };

  // 加载人群列表
  const fetchCrowds = async () => {
    try {
      const res = await API.get('/api/user-crowd/?page=1&page_size=100');
      if (res.data.success) {
        setCrowds((res.data.data || []).map(c => ({ value: c.id, label: c.name })));
      }
    } catch (e) {
      showError('加载人群列表失败: ' + e.message);
    }
  };

  // 加载我的看板列表
  const fetchDashboards = async () => {
    try {
      const res = await API.get('/api/operation-dashboard');
      if (res.data.success) {
        setDashboards(res.data.data || []);
      }
    } catch (e) {
      showError('加载看板列表失败: ' + e.message);
    }
  };

  // 加载统计数据
  const fetchStats = async () => {
    if (!targetId) {
      Toast.warning('请先选择统计对象');
      return;
    }
    setLoading(true);
    try {
      const res = await API.get(`/api/operation-dashboard/stats?dimension=${dimension}&target_id=${targetId}&period=${period}`);
      if (res.data.success) {
        setStats(res.data.data);
      } else {
        showError(res.data.message || '加载统计数据失败');
      }
    } catch (e) {
      showError('加载统计数据失败: ' + e.message);
    }
    setLoading(false);
  };

  // 保存看板
  const handleSaveDashboard = async () => {
    if (!dashboardName.trim()) {
      Toast.warning('请输入看板名称');
      return;
    }
    if (!targetId) {
      Toast.warning('请先选择统计对象');
      return;
    }

    const config = JSON.stringify({ dimension, target_id: targetId, period, metrics: selectedMetrics });

    try {
      const res = await API.post('/api/operation-dashboard', { name: dashboardName, config });
      if (res.data.success) {
        showSuccess('保存成功');
        setSaveModalVisible(false);
        setDashboardName('');
        fetchDashboards();
      } else {
        showError(res.data.message || '保存失败');
      }
    } catch (e) {
      showError('保存失败: ' + e.message);
    }
  };

  // 加载看板配置
  const handleLoadDashboard = (dashboardId) => {
    const dashboard = dashboards.find(d => d.id === dashboardId);
    if (!dashboard) return;

    try {
      const config = JSON.parse(dashboard.config);
      setDimension(config.dimension);
      setTargetId(config.target_id);
      setPeriod(config.period || '7d');
      setSelectedMetrics(config.metrics || ['quota_health']);
      setSelectedDashboard(dashboardId);
    } catch (e) {
      showError('加载看板配置失败: ' + e.message);
    }
  };

  // 删除看板
  const handleDeleteDashboard = async (dashboardId) => {
    try {
      const res = await API.delete(`/api/operation-dashboard/${dashboardId}`);
      if (res.data.success) {
        showSuccess('删除成功');
        if (selectedDashboard === dashboardId) {
          setSelectedDashboard(null);
        }
        fetchDashboards();
      } else {
        showError(res.data.message || '删除失败');
      }
    } catch (e) {
      showError('删除失败: ' + e.message);
    }
  };

  useEffect(() => {
    fetchActivities();
    fetchCrowds();
    fetchDashboards();
  }, []);

  useEffect(() => {
    if (targetId) {
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension, targetId, period]);

  // 渲染趋势图
  useEffect(() => {
    if (!trendChartRef.current || !stats || !stats.trends || stats.trends.length === 0) return;

    if (trendInstanceRef.current) {
      trendInstanceRef.current.release();
    }

    const spec = {
      type: 'line',
      data: [{ id: 'trend', values: stats.trends.map(t => ({ date: t.date, count: +(t.count / quotaPerUnit).toFixed(2) })) }],
      xField: 'date',
      yField: 'count',
      point: { visible: true, size: 4 },
      line: { style: { lineWidth: 2 } },
      axes: [
        { orient: 'bottom', label: { style: { fontSize: 11 } } },
        { orient: 'left', label: { style: { fontSize: 11 } } },
      ],
    };

    trendInstanceRef.current = new VChart(spec, { dom: trendChartRef.current });
    trendInstanceRef.current.renderSync();

    return () => {
      if (trendInstanceRef.current) {
        trendInstanceRef.current.release();
        trendInstanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats?.trends]);

  const targetOptions = dimension === 'activity' ? activities : crowds;

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* 第一行：看板管理 */}
      <Card style={{ ...cardStyle, marginBottom: 12 }} bodyStyle={{ padding: '12px 20px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Select
            value={selectedDashboard}
            onChange={(val) => { setSelectedDashboard(val); handleLoadDashboard(val); }}
            style={{ width: 180 }}
            placeholder="我的看板"
            showClear
            optionList={dashboards.map(d => ({ value: d.id, label: d.name }))}
            renderSelectedItem={(option) => (
              <Space>
                <span>{option.label}</span>
                <Trash2
                  size={14}
                  style={{ cursor: 'pointer', color: '#f5222d' }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteDashboard(option.value); }}
                />
              </Space>
            )}
          />
          <Button icon={<Save size={16} />} onClick={() => setSaveModalVisible(true)}>保存看板</Button>
        </div>
      </Card>

      {/* 第二行：筛选条件 */}
      <Card style={{ ...cardStyle, marginBottom: 24 }} bodyStyle={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            value={dimension}
            onChange={(val) => { setDimension(val); setTargetId(null); }}
            style={{ width: 120 }}
            optionList={[
              { value: 'activity', label: '活动' },
              { value: 'crowd', label: '人群' },
            ]}
          />
          <Select
            value={targetId}
            onChange={setTargetId}
            style={{ width: 200 }}
            placeholder={`选择${dimension === 'activity' ? '活动' : '人群'}`}
            showSearch
            filter
            optionList={targetOptions}
          />
          <Select
            value={period}
            onChange={setPeriod}
            style={{ width: 120 }}
            optionList={[
              { value: 'today', label: '今天' },
              { value: '7d', label: '近7天' },
              { value: '30d', label: '近30天' },
            ]}
          />
          {/* 指标筛选暂时隐藏
          <Checkbox.Group
            value={selectedMetrics}
            onChange={setSelectedMetrics}
            options={[
              { label: '拉新转化', value: 'acquisition' },
              { label: '活跃留存', value: 'engagement' },
              { label: '付费营收', value: 'revenue' },
              { label: '积分健康度', value: 'quota_health' },
            ]}
          />
          */}
        </div>
      </Card>

      <Spin spinning={loading}>
        {stats && (
          <>
            {/* 活动专属指标 */}
            {stats.activity_stats && (
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总参与人数</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.activity_stats.total_users}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总发放积分</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{(stats.activity_stats.total_granted / quotaPerUnit).toFixed(2)}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总参与次数</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.activity_stats.total_participations}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>今日参与人数</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.activity_stats.today_users}</div>
                  </Card>
                </Col>
              </Row>
            )}

            {/* 拉新与转化 */}
            {selectedMetrics.includes('acquisition') && stats.acquisition && (
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>新注册用户</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.acquisition.new_users}</div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>首次消费用户</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.acquisition.first_consume_users}</div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>转化率</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>
                      {(stats.acquisition.conversion_rate * 100).toFixed(1)}%
                    </div>
                  </Card>
                </Col>
              </Row>
            )}

            {/* 活跃与留存 */}
            {selectedMetrics.includes('engagement') && stats.engagement && (
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>日活(DAU)</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.engagement.dau}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>周活(WAU)</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.engagement.wau}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>月活(MAU)</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.engagement.mau}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>次日留存</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>
                      {(stats.engagement.retention_day1 * 100).toFixed(1)}%
                    </div>
                  </Card>
                </Col>
              </Row>
            )}

            {/* 付费与营收 */}
            {selectedMetrics.includes('revenue') && stats.revenue && (
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总充值额</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.revenue.total_revenue}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>付费人数</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.revenue.paying_users}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>ARPU</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{stats.revenue.arpu.toFixed(0)}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>付费率</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>
                      {(stats.revenue.paying_rate * 100).toFixed(1)}%
                    </div>
                  </Card>
                </Col>
              </Row>
            )}

            {/* 积分健康度 */}
            {selectedMetrics.includes('quota_health') && stats.quota_health && (
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总发放积分</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{(stats.quota_health.total_granted / quotaPerUnit).toFixed(2)}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>总消耗积分</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{(stats.quota_health.total_consumed / quotaPerUnit).toFixed(2)}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>沉淀剩余</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{(stats.quota_health.total_remaining / quotaPerUnit).toFixed(2)}</div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card bodyStyle={{ padding: '16px 20px' }} style={cardStyle}>
                    <div style={{ fontSize: 14, color: '#8F9BBA', fontWeight: 500, marginBottom: 6 }}>人均消耗</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1B2559' }}>{(stats.quota_health.avg_consumed / quotaPerUnit).toFixed(2)}</div>
                  </Card>
                </Col>
              </Row>
            )}

            {/* 趋势图 */}
            {stats.trends && stats.trends.length > 0 && (
              <Card style={{ ...cardStyle, marginBottom: 24 }} bodyStyle={{ padding: 16 }}>
                <Title heading={6} style={{ marginBottom: 12 }}>消费趋势</Title>
                <div ref={trendChartRef} style={{ width: '100%', height: 260 }} />
              </Card>
            )}
          </>
        )}

        {!stats && !loading && (
          <Card style={cardStyle} bodyStyle={{ padding: '48px 20px', textAlign: 'center' }}>
            <Text type="tertiary">请选择统计维度和对象，查看运营数据</Text>
          </Card>
        )}
      </Spin>

      {/* 保存看板对话框 */}
      <Modal
        title="保存看板"
        visible={saveModalVisible}
        onOk={handleSaveDashboard}
        onCancel={() => { setSaveModalVisible(false); setDashboardName(''); }}
        okText="保存"
        cancelText="取消"
      >
        <Input
          placeholder="看板名称"
          value={dashboardName}
          onChange={setDashboardName}
        />
      </Modal>
    </div>
  );
};

export default OperationDashboard;
