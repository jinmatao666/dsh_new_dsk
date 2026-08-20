import React from 'react';
import {
  Banner,
  Button,
  Card,
  CheckboxGroup,
  DatePicker,
  InputNumber,
  Progress,
  RadioGroup,
  Radio,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from '@douyinfe/semi-ui';

const { Text, Title } = Typography;

const RANGE_ALL = 'all';
const RANGE_TIME = 'time_range';
const RANGE_LATEST = 'latest_n';

const Dot = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: color,
      marginRight: 6
    }}
  />
);

// 连接状态卡:源库(线上) + 目标库(当前)
const ConnectionCard = ({ status }) => {
  const sourceOk = status.source_connected;
  return (
    <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '14px 18px' }}>
      <Space spacing="loose" align="start" wrap>
        <div style={{ minWidth: 280 }}>
          <Text type="tertiary" size="small">源库（线上）</Text>
          <div style={{ marginTop: 6 }}>
            <Dot color={sourceOk ? '#34C759' : '#FF3B30'} />
            <Text strong>{status.source_masked || '未配置'}</Text>
          </div>
          {status.source_version && (
            <Text type="tertiary" size="small">MySQL {status.source_version}</Text>
          )}
          {status.source_error && (
            <div><Text type="danger" size="small">{status.source_error}</Text></div>
          )}
        </div>
        <div style={{ minWidth: 240 }}>
          <Text type="tertiary" size="small">目标库（当前服务连接）</Text>
          <div style={{ marginTop: 6 }}>
            <Text strong>{status.target_db || '-'}</Text>
            {status.target_isolated ? (
              <Tag color="green" style={{ marginLeft: 8 }}>隔离库</Tag>
            ) : (
              <Tag color="red" style={{ marginLeft: 8 }}>线上库</Tag>
            )}
          </div>
        </div>
      </Space>
    </Card>
  );
};

const previewColumns = [
  { title: '模块', dataIndex: 'module' },
  { title: '表', dataIndex: 'table' },
  {
    title: '将同步行数',
    dataIndex: 'sync_rows',
    render: (v) => <Text strong>{v}</Text>
  },
  {
    title: '目标表现有行数（将清空）',
    dataIndex: 'target_rows',
    render: (v) => <Text type={v > 0 ? 'warning' : 'tertiary'}>{v}</Text>
  }
];

const statusLabel = {
  running: { text: '同步中', color: 'blue' },
  succeeded: { text: '成功', color: 'green' },
  partial: { text: '部分成功', color: 'orange' },
  failed: { text: '失败', color: 'red' }
};

const OnlineDataSyncView = (props) => {
  const {
    loading,
    forbidden,
    status,
    enabled,
    modules,
    selectedModules,
    setSelectedModules,
    allSelected,
    toggleSelectAll,
    rangeMode,
    setRangeMode,
    timeRange,
    setTimeRange,
    latestN,
    setLatestN,
    heavyFullWarning,
    resetPreview,
    preview,
    previewLoading,
    handlePreview,
    handleExecute,
    running,
    task
  } = props;

  if (loading) {
    return (
      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div style={{ marginTop: 12 }}>
        <Banner
          type="warning"
          description="线上数据同步仅限超级管理员（root）使用，当前账号无权限。"
        />
      </div>
    );
  }

  if (!status) return null;

  const disabled = !enabled || running;

  const moduleOptions = modules.map((m) => ({
    label: `${m.name}（源库 ${m.total_rows || 0} 行）`,
    value: m.key
  }));

  return (
    <div style={{ marginTop: 12 }}>
      <Card style={{ maxWidth: 900 }}>
        <Title heading={5} style={{ marginBottom: 4 }}>
          线上数据同步
        </Title>
        <Text type="tertiary">
          把线上库数据同步到当前连接的隔离库，便于本地调试。仅支持 MySQL→MySQL。
        </Text>

        <div style={{ marginTop: 16 }}>
          <ConnectionCard status={status} />
        </div>

        {!enabled && (
          <Banner
            type="danger"
            description={status.disabled_reason || '同步功能当前不可用'}
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 模块选择 */}
        <div style={{ marginBottom: 20 }}>
          <Space style={{ marginBottom: 8 }}>
            <Text strong>选择模块</Text>
            <Button size="small" theme="borderless" disabled={disabled} onClick={toggleSelectAll}>
              {allSelected ? '取消全选' : '全选'}
            </Button>
          </Space>
          <CheckboxGroup
            options={moduleOptions}
            value={selectedModules}
            disabled={disabled}
            onChange={(v) => {
              setSelectedModules(v);
              resetPreview();
            }}
            direction="horizontal"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}
          />
          {heavyFullWarning && (
            <Banner
              type="warning"
              description="已选择大表模块（调用日志 / 埋点与反馈）且为全量模式，数据量可能很大，建议改用时间区间或最近 N 条。"
              style={{ marginTop: 10 }}
            />
          )}
        </div>

        {/* 范围选择 */}
        <div style={{ marginBottom: 20 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>同步范围</Text>
          <RadioGroup
            value={rangeMode}
            disabled={disabled}
            onChange={(e) => {
              setRangeMode(e.target.value);
              resetPreview();
            }}
          >
            <Radio value={RANGE_ALL}>全量</Radio>
            <Radio value={RANGE_TIME}>时间区间</Radio>
            <Radio value={RANGE_LATEST}>最近 N 条</Radio>
          </RadioGroup>
          <div style={{ marginTop: 12 }}>
            {rangeMode === RANGE_TIME && (
              <DatePicker
                type="dateTimeRange"
                value={timeRange}
                disabled={disabled}
                onChange={(v) => {
                  setTimeRange(v);
                  resetPreview();
                }}
                style={{ width: 400 }}
              />
            )}
            {rangeMode === RANGE_LATEST && (
              <InputNumber
                min={1}
                max={2000000}
                step={100}
                value={latestN}
                disabled={disabled}
                onChange={(v) => {
                  setLatestN(v);
                  resetPreview();
                }}
                suffix="条"
                style={{ width: 200 }}
              />
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <Space style={{ marginBottom: 16 }}>
          <Button theme="light" loading={previewLoading} disabled={disabled} onClick={handlePreview}>
            预览
          </Button>
          <Button type="danger" theme="solid" disabled={disabled} loading={running} onClick={handleExecute}>
            开始同步
          </Button>
        </Space>

        {/* 预览结果 */}
        {preview && (
          <div style={{ marginBottom: 16 }}>
            <Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
              共将同步 <Text strong>{preview.total_sync}</Text> 行
            </Text>
            <Table
              columns={previewColumns}
              dataSource={preview.tables}
              pagination={false}
              size="small"
              rowKey={(r) => `${r.module}.${r.table}`}
            />
          </div>
        )}

        {/* 任务进度 */}
        {task && (
          <Card style={{ background: 'var(--semi-color-fill-0)' }} bodyStyle={{ padding: '12px 16px' }}>
            <Space style={{ marginBottom: 8 }}>
              <Tag color={(statusLabel[task.status] || {}).color}>
                {(statusLabel[task.status] || {}).text || task.status}
              </Tag>
              <Text type="tertiary">
                {task.done_tables}/{task.total_tables} 张表
                {task.current_table ? ` · 当前：${task.current_table}` : ''}
                {` · 累计 ${task.total_rows} 行`}
              </Text>
            </Space>
            <Progress
              percent={task.total_tables ? Math.round((task.done_tables / task.total_tables) * 100) : 0}
              showInfo
            />
            {task.errors && task.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {task.errors.map((e) => (
                  <div key={e.table}>
                    <Text type="danger" size="small">{e.table}：{e.error}</Text>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </Card>
    </div>
  );
};

export default OnlineDataSyncView;
