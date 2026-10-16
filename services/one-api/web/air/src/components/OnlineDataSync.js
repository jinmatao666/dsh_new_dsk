import React, { useEffect, useMemo, useState } from 'react';
import { Banner, Input, Modal, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../helpers';
import OnlineDataSyncView from './OnlineDataSyncView';

const { Text } = Typography;

// 范围模式常量,与后端 service/datasync/range.go 保持一致
const RANGE_ALL = 'all';
const RANGE_TIME = 'time_range';
const RANGE_LATEST = 'latest_n';

// 大表模块,选「全量」时给黄色提示
const HEAVY_MODULES = ['logs', 'events'];

const formatRows = (n) => {
  if (n == null) return '-';
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return `${n}`;
};

const OnlineDataSync = () => {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false); // 403 非 root
  const [status, setStatus] = useState(null);

  const [selectedModules, setSelectedModules] = useState([]);
  const [rangeMode, setRangeMode] = useState(RANGE_ALL);
  const [timeRange, setTimeRange] = useState([]); // [start, end] Date
  const [latestN, setLatestN] = useState(1000);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const [running, setRunning] = useState(false);
  const [task, setTask] = useState(null);

  const loadStatus = async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const res = await API.get('/api/sync/status');
      if (!res) {
        // 拦截器吞掉错误(含 403)后 res 为 undefined
        setForbidden(true);
        return;
      }
      const { success, message, data } = res.data;
      if (success) {
        setStatus(data);
      } else {
        showError('获取同步状态失败：' + message);
      }
    } catch (e) {
      showError('获取同步状态失败：' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const enabled = status?.enabled;
  const modules = status?.modules || [];

  const resetPreview = () => setPreview(null);

  const allModuleKeys = useMemo(() => modules.map((m) => m.key), [modules]);
  const allSelected = selectedModules.length > 0 && selectedModules.length === allModuleKeys.length;

  const toggleSelectAll = () => {
    setSelectedModules(allSelected ? [] : allModuleKeys);
    resetPreview();
  };

  // 是否勾选了大表模块且选了全量
  const heavyFullWarning =
    rangeMode === RANGE_ALL && selectedModules.some((k) => HEAVY_MODULES.includes(k));

  const buildRange = () => {
    if (rangeMode === RANGE_TIME) {
      const [s, e] = timeRange;
      return {
        mode: RANGE_TIME,
        start: s ? Math.floor(new Date(s).getTime() / 1000) : 0,
        end: e ? Math.floor(new Date(e).getTime() / 1000) : 0
      };
    }
    if (rangeMode === RANGE_LATEST) {
      return { mode: RANGE_LATEST, count: latestN || 1000 };
    }
    return { mode: RANGE_ALL };
  };

  const validateBeforeRun = () => {
    if (selectedModules.length === 0) {
      showError('请至少选择一个模块');
      return false;
    }
    if (rangeMode === RANGE_TIME) {
      const [s, e] = timeRange;
      if (!s || !e) {
        showError('请选择时间区间');
        return false;
      }
    }
    return true;
  };

  const handlePreview = async () => {
    if (!validateBeforeRun()) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await API.post('/api/sync/preview', {
        modules: selectedModules,
        range: buildRange()
      });
      if (!res) return;
      const { success, message, data } = res.data;
      if (success) {
        setPreview(data);
      } else {
        showError('预览失败：' + message);
      }
    } catch (e) {
      showError('预览失败：' + (e.message || e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const pollTask = async (taskId) => {
    try {
      const res = await API.get(`/api/sync/task/${taskId}`);
      if (!res) {
        setRunning(false);
        return;
      }
      const { success, data } = res.data;
      if (!success) {
        setRunning(false);
        return;
      }
      setTask(data);
      if (data.status === 'running') {
        setTimeout(() => pollTask(taskId), 2000);
      } else {
        setRunning(false);
        if (data.status === 'succeeded') {
          showSuccess(`同步完成，共 ${data.total_rows} 行`);
        } else if (data.status === 'partial') {
          showError(`部分表同步失败（${data.errors.length} 张）`);
        } else {
          showError('同步失败');
        }
        loadStatus();
      }
    } catch (e) {
      setRunning(false);
      showError('查询任务进度失败：' + (e.message || e));
    }
  };

  const doExecute = async (confirmName) => {
    setRunning(true);
    setTask(null);
    try {
      const res = await API.post('/api/sync/execute', {
        modules: selectedModules,
        range: buildRange(),
        confirm: confirmName
      });
      if (!res) {
        setRunning(false);
        return;
      }
      const { success, message, data } = res.data;
      if (success) {
        pollTask(data.task_id);
      } else {
        setRunning(false);
        showError('启动同步失败：' + message);
      }
    } catch (e) {
      setRunning(false);
      showError('启动同步失败：' + (e.message || e));
    }
  };

  const handleExecute = () => {
    if (!validateBeforeRun()) return;
    let confirmName = '';
    const targetDB = status?.target_db || '';
    Modal.confirm({
      title: '确认开始同步',
      content: (
        <div>
          <Banner
            type="danger"
            description={`目标库【${targetDB}】中所选模块对应的表将被清空并用线上数据重建，操作不可恢复。`}
            style={{ marginBottom: 12 }}
          />
          <Text>请输入目标库名 <Text strong>{targetDB}</Text> 以确认：</Text>
          <Input
            placeholder={targetDB}
            onChange={(v) => {
              confirmName = v;
            }}
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: '开始同步',
      cancelText: '取消',
      okButtonProps: { type: 'danger' },
      onOk: () => {
        if (confirmName.trim() !== targetDB) {
          showError('库名不一致，已取消');
          return Promise.reject();
        }
        return doExecute(confirmName.trim());
      }
    });
  };

  return (
    <OnlineDataSyncView
      loading={loading}
      forbidden={forbidden}
      status={status}
      enabled={enabled}
      modules={modules}
      selectedModules={selectedModules}
      setSelectedModules={setSelectedModules}
      allSelected={allSelected}
      toggleSelectAll={toggleSelectAll}
      rangeMode={rangeMode}
      setRangeMode={setRangeMode}
      timeRange={timeRange}
      setTimeRange={setTimeRange}
      latestN={latestN}
      setLatestN={setLatestN}
      heavyFullWarning={heavyFullWarning}
      resetPreview={resetPreview}
      preview={preview}
      previewLoading={previewLoading}
      handlePreview={handlePreview}
      handleExecute={handleExecute}
      running={running}
      task={task}
      formatRows={formatRows}
    />
  );
};

export default OnlineDataSync;
