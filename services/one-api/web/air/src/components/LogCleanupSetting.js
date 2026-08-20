import React, { useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Modal,
  Select,
  Space,
  Typography
} from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../helpers';

const { Text, Title } = Typography;

// 日志类型,与后端 model/log.go 中的 LogType* 常量保持一致
const LOG_TYPE_OPTIONS = [
  { label: '充值', value: 1 },
  { label: '消费', value: 2 },
  { label: '管理', value: 3 },
  { label: '系统', value: 4 },
  { label: '测试', value: 5 },
  { label: '错误请求', value: 6 }
];

const formatBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

// 日志清理工具:按时间 + 多选类型预览待清理条数与估算大小,确认后执行清理
const LogCleanupSetting = () => {
  const defaultDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [logTypes, setLogTypes] = useState([]);
  const [stat, setStat] = useState(null); // { count, estimated_bytes }
  const [calcLoading, setCalcLoading] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);

  const buildQuery = () => {
    const ts = Math.floor(new Date(targetDate).getTime() / 1000);
    let q = `target_timestamp=${ts}`;
    if (logTypes.length > 0) {
      q += `&types=${logTypes.join(',')}`;
    }
    return q;
  };

  const handleCalculate = async () => {
    if (!targetDate) {
      showError('请先选择目标时间');
      return;
    }
    setCalcLoading(true);
    setStat(null);
    try {
      const res = await API.get(`/api/log/cleanup/stat?${buildQuery()}`);
      const { success, message, data } = res.data;
      if (success) {
        setStat(data);
      } else {
        showError('计算失败:' + message);
      }
    } catch (e) {
      showError('计算失败:' + (e.message || e));
    } finally {
      setCalcLoading(false);
    }
  };

  const doClean = async () => {
    setCleanLoading(true);
    try {
      const res = await API.delete(`/api/log/?${buildQuery()}`);
      const { success, message, data } = res.data;
      if (success) {
        showSuccess(`${data} 条日志已清理！`);
        setStat(null);
      } else {
        showError('日志清理失败:' + message);
      }
    } catch (e) {
      showError('日志清理失败:' + (e.message || e));
    } finally {
      setCleanLoading(false);
    }
  };

  const handleClean = () => {
    if (!targetDate) {
      showError('请先选择目标时间');
      return;
    }
    const typeText =
      logTypes.length > 0
        ? LOG_TYPE_OPTIONS.filter((o) => logTypes.includes(o.value))
            .map((o) => o.label)
            .join('、')
        : '全部类型';
    Modal.confirm({
      title: '确认清理日志',
      content: (
        <Text>
          将永久删除 {new Date(targetDate).toLocaleString()} 之前的
          【{typeText}】日志
          {stat ? `（约 ${stat.count} 条）` : ''}，此操作不可恢复，是否继续？
        </Text>
      ),
      okText: '确认清理',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: doClean
    });
  };

  return (
    <div style={{ marginTop: 12 }}>
      <Card style={{ maxWidth: 720 }}>
        <Title heading={5} style={{ marginBottom: 4 }}>
          日志清理工具
        </Title>
        <Text type="tertiary">
          清理指定时间之前的历史日志，可按日志类型筛选。建议先计算待清理数据量再执行。
        </Text>
        <div style={{ marginTop: 24 }}>
          <Space vertical align="start" spacing="loose" style={{ width: '100%' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                目标时间（清理此时间之前的日志）
              </Text>
              <DatePicker
                type="dateTime"
                value={targetDate}
                onChange={(date) => {
                  setTargetDate(date);
                  setStat(null);
                }}
                style={{ width: 280 }}
              />
            </div>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                日志类型（不选则清理全部类型）
              </Text>
              <Select
                multiple
                placeholder="选择要清理的日志类型"
                value={logTypes}
                onChange={(v) => {
                  setLogTypes(v);
                  setStat(null);
                }}
                optionList={LOG_TYPE_OPTIONS}
                style={{ width: 360 }}
                maxTagCount={4}
              />
            </div>
            <Space>
              <Button
                theme="light"
                loading={calcLoading}
                onClick={handleCalculate}
              >
                计算
              </Button>
              <Button
                type="danger"
                theme="solid"
                loading={cleanLoading}
                onClick={handleClean}
              >
                清理
              </Button>
            </Space>
            {stat && (
              <Card
                style={{ width: '100%', background: 'var(--semi-color-fill-0)' }}
                bodyStyle={{ padding: '12px 16px' }}
              >
                <Text>
                  待清理 <Text strong>{stat.count}</Text> 条日志，约{' '}
                  <Text strong>{formatBytes(stat.estimated_bytes)}</Text>
                  <Text type="tertiary">（大小为估算值）</Text>
                </Text>
              </Card>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
};

export default LogCleanupSetting;
