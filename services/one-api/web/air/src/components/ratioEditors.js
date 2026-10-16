import React, { useEffect, useMemo, useState } from 'react';
import { Button, Icon, Input } from 'semantic-ui-react';

// 工具:把 JSON 字符串解析为对象,失败返回 {}
export const parseRatioJSON = (s) => {
  if (!s || s.trim() === '' || s.trim() === '{}') return {};
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
};

// 工具:把对象重新序列化为 JSON 字符串(2 空格缩进,与原逻辑一致)
export const stringifyRatio = (obj) => JSON.stringify(obj, null, 2);

// 工具:把输入的字符串尽量转成数值;空串保留,便于用户清空再填
export const coerceNumber = (v) => {
  if (v === '' || v === null || v === undefined) return '';
  const num = Number(v);
  return Number.isFinite(num) ? num : v;
};

// 合并编辑「模型倍率 + 补全倍率」的表格:
// 一行对应一个模型名,两个值分别写回两份 JSON 字符串
// 任一列为空则该 key 不写入对应 JSON,互不污染
export const MergedModelRatioTable = ({ modelRatio, completionRatio, onChangeModel, onChangeCompletion }) => {
  const mObj = useMemo(() => parseRatioJSON(modelRatio), [modelRatio]);
  const cObj = useMemo(() => parseRatioJSON(completionRatio), [completionRatio]);

  // 以两张 map 的 key 并集生成行,保留插入顺序(mObj 优先)
  const rows = useMemo(() => {
    const seen = new Set();
    const list = [];
    Object.keys(mObj).forEach((k) => { seen.add(k); list.push({ name: k, model: String(mObj[k]), completion: k in cObj ? String(cObj[k]) : '' }); });
    Object.keys(cObj).forEach((k) => {
      if (!seen.has(k)) list.push({ name: k, model: '', completion: String(cObj[k]) });
    });
    return list;
  }, [mObj, cObj]);

  const [filter, setFilter] = useState('');

  // 把所有行重新聚合为两个 JSON 字符串,回传父组件
  const emit = (nextRows) => {
    const nextModel = {};
    const nextCompletion = {};
    nextRows.forEach((r) => {
      const k = (r.name || '').trim();
      if (!k) return;
      if (r.model !== '' && r.model !== null && r.model !== undefined) {
        nextModel[k] = coerceNumber(r.model);
      }
      if (r.completion !== '' && r.completion !== null && r.completion !== undefined) {
        nextCompletion[k] = coerceNumber(r.completion);
      }
    });
    onChangeModel(stringifyRatio(nextModel));
    onChangeCompletion(stringifyRatio(nextCompletion));
  };

  const updateRow = (idx, patch) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    emit(next);
  };
  const deleteRow = (idx) => emit(rows.filter((_, i) => i !== idx));
  const addRow = () => emit([...rows, { name: '', model: '', completion: '' }]);

  const filtered = filter
    ? rows.map((r, i) => ({ ...r, __idx: i })).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
    : rows.map((r, i) => ({ ...r, __idx: i }));

  // macOS 风格的卡片容器样式(两个编辑器共用)
  const cardStyle = {
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
  };
  // 4 列网格:模型名 | 模型倍率 | 补全倍率 | 删除
  const gridCols = 'minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) 40px';
  const rowPadding = '6px 16px';

  return (
    <div style={cardStyle}>
      {/* 头部:搜索 + 计数 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)',
        background: '#fafafa'
      }}>
        <Input
          icon='search'
          iconPosition='left'
          size='small'
          placeholder='搜索模型名'
          value={filter}
          onChange={(e, d) => setFilter(d.value)}
          style={{ width: 280 }}
        />
        <span style={{ fontSize: 12, color: '#86868b' }}>共 {rows.length} 个模型</span>
      </div>

      {/* 表头 */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridCols, gap: 10,
        padding: '8px 16px', fontSize: 12, fontWeight: 500, color: '#6e6e73',
        background: '#fafafa', borderBottom: '1px solid rgba(0,0,0,0.06)'
      }}>
        <div>模型名称</div>
        <div>模型倍率</div>
        <div>补全倍率</div>
        <div />
      </div>

      {/* 数据行 */}
      <div style={{ maxHeight: 440, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: '#86868b', padding: 24, fontSize: 13 }}>
            暂无配置,点击下方「新增模型」添加
          </div>
        )}
        {filtered.map((r, i) => (
          <div key={r.__idx} style={{
            display: 'grid', gridTemplateColumns: gridCols, gap: 10,
            padding: rowPadding, alignItems: 'center',
            borderBottom: i < filtered.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none'
          }}>
            <Input fluid size='small' value={r.name} placeholder='例如 gpt-4o'
              onChange={(e, d) => updateRow(r.__idx, { name: d.value })} />
            <Input fluid size='small' type='number' step='0.01' value={r.model} placeholder='2.5'
              onChange={(e, d) => updateRow(r.__idx, { model: d.value })} />
            <Input fluid size='small' type='number' step='0.01' value={r.completion} placeholder='3'
              onChange={(e, d) => updateRow(r.__idx, { completion: d.value })} />
            <Button icon basic size='mini' compact type='button' title='删除'
              style={{ boxShadow: 'none', color: '#86868b', background: 'transparent' }}
              onClick={() => deleteRow(r.__idx)}>
              <Icon name='trash alternate outline' />
            </Button>
          </div>
        ))}
      </div>

      {/* 底部动作栏 */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid rgba(0,0,0,0.06)', background: '#fafafa'
      }}>
        <Button size='small' basic type='button' onClick={addRow}
          style={{ boxShadow: 'none' }}>
          <Icon name='plus' />新增模型
        </Button>
      </div>
    </div>
  );
};

// 紧凑分组倍率编辑器:使用 Grid auto-fill,屏幕宽能放几列就放几列
// 分组一般只有 2~5 个,用表格会非常空旷
export const CompactGroupRatioEditor = ({ value, onChange, nameLabel = '分组名称', valueLabel = '倍率', namePlaceholder = '例如 default', valuePlaceholder = '1', emptyText = '暂无分组,点击下方「新增」添加', addText = '新增分组' }) => {
  const obj = useMemo(() => parseRatioJSON(value), [value]);

  // 用内部 state 维护行数据，支持空行编辑
  const [localRows, setLocalRows] = useState(() =>
    Object.entries(obj).map(([k, v]) => ({ name: k, value: String(v) }))
  );

  // 当外部 value 变化时同步（但保留未提交的空行）
  useEffect(() => {
    const fromProp = Object.entries(parseRatioJSON(value)).map(([k, v]) => ({ name: k, value: String(v) }));
    setLocalRows((prev) => {
      const hasEmptyRows = prev.some((r) => !(r.name || '').trim());
      if (!hasEmptyRows) return fromProp;
      // 保留空行，更新有名称的行
      const propMap = Object.fromEntries(fromProp.map((r) => [r.name, r.value]));
      return prev.map((r) => {
        const k = (r.name || '').trim();
        if (!k) return r;
        if (k in propMap) return { name: k, value: propMap[k] };
        return r;
      });
    });
  }, [value]);

  const emit = (nextRows) => {
    setLocalRows(nextRows);
    const next = {};
    nextRows.forEach((r) => {
      const k = (r.name || '').trim();
      if (!k) return;
      next[k] = coerceNumber(r.value);
    });
    onChange(stringifyRatio(next));
  };

  const updateRow = (idx, patch) => emit(localRows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const deleteRow = (idx) => emit(localRows.filter((_, i) => i !== idx));
  const addRow = () => {
    const next = [...localRows, { name: '', value: '' }];
    setLocalRows(next);
  };

  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: 10,
      overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
    }}>
      {/* 表头(简化:只有 2 列,不放搜索) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 40px',
        gap: 10,
        padding: '8px 16px',
        fontSize: 12,
        fontWeight: 500,
        color: '#6e6e73',
        background: '#fafafa',
        borderBottom: '1px solid rgba(0,0,0,0.06)'
      }}>
        <div>{nameLabel}</div>
        <div>{valueLabel}</div>
        <div />
      </div>

      {/* 数据行 */}
      {localRows.length === 0 && (
        <div style={{ textAlign: 'center', color: '#86868b', padding: 24, fontSize: 13 }}>
          {emptyText}
        </div>
      )}
      {localRows.map((r, idx) => (
        <div key={idx} style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) 40px',
          gap: 10,
          padding: '6px 16px',
          alignItems: 'center',
          borderBottom: idx < localRows.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none'
        }}>
          <Input fluid size='small' value={r.name} placeholder={namePlaceholder}
            onChange={(e, d) => updateRow(idx, { name: d.value })} />
          <Input fluid size='small' type='number' step='0.01' value={r.value} placeholder={valuePlaceholder}
            onChange={(e, d) => updateRow(idx, { value: d.value })} />
          <Button icon basic size='mini' compact type='button' title='删除'
            style={{ boxShadow: 'none', color: '#86868b', background: 'transparent' }}
            onClick={() => deleteRow(idx)}>
            <Icon name='trash alternate outline' />
          </Button>
        </div>
      ))}

      {/* 底部动作栏 */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: '#fafafa'
      }}>
        <Button size='small' basic type='button' onClick={addRow} style={{ boxShadow: 'none' }}>
          <Icon name='plus' />{addText}
        </Button>
      </div>
    </div>
  );
};
