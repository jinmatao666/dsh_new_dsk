import React, { useMemo, useState } from 'react';
import ColumnSelector from '../components/ColumnSelector';

/**
 * 统一的表格列配置 hook。
 * 持久化到 localStorage,勾选即时生效,固定列(always)恒显示。
 *
 * @param {object} opts
 * @param {string} opts.storageKey localStorage 键,每个表格唯一
 * @param {Array<{key:string,label:string,always?:boolean}>} opts.columnMeta 列元信息,key 对应列的 dataIndex
 * @param {Array} opts.allColumns 该表完整的 Semi columns 数组
 * @param {object} [opts.buttonProps] 透传给「列配置」按钮的属性
 * @returns {{ visibleColumns: Array, columnConfigButton: React.ReactNode, visibleKeys: string[] }}
 */
export default function useColumnConfig({ storageKey, columnMeta, allColumns, buttonProps }) {
  const defaultVisibleKeys = () => columnMeta.map((c) => c.key);

  const loadVisibleKeys = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultVisibleKeys();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultVisibleKeys();
      const valid = parsed.filter((k) => columnMeta.some((c) => c.key === k));
      // 强制补回固定列
      columnMeta.forEach((c) => {
        if (c.always && !valid.includes(c.key)) valid.push(c.key);
      });
      return valid.length ? valid : defaultVisibleKeys();
    } catch {
      return defaultVisibleKeys();
    }
  };

  const [visibleKeys, setVisibleKeys] = useState(loadVisibleKeys);

  const onToggle = (key, checked) => {
    setVisibleKeys((prev) => {
      const next = checked
        ? [...new Set([...prev, key])]
        : prev.filter((k) => k !== key);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore 写入失败 */
      }
      return next;
    });
  };

  const alwaysKeys = useMemo(
    () => columnMeta.filter((c) => c.always).map((c) => c.key),
    [columnMeta],
  );

  const metaKeys = useMemo(
    () => new Set(columnMeta.map((c) => c.key)),
    [columnMeta],
  );

  const visibleColumns = useMemo(
    () =>
      allColumns.filter((c) => {
        // 列标识优先取 dataIndex,其次 key(纯 render 列用 key 纳入管理)
        const colKey = c.dataIndex != null ? c.dataIndex : c.key;
        // 不受列配置管理的列(无标识或未在 columnMeta 声明)恒显示
        if (colKey == null || !metaKeys.has(colKey)) return true;
        return alwaysKeys.includes(colKey) || visibleKeys.includes(colKey);
      }),
    [allColumns, alwaysKeys, metaKeys, visibleKeys],
  );

  const columnConfigButton = (
    <ColumnSelector
      columnMeta={columnMeta}
      visibleKeys={visibleKeys}
      onToggle={onToggle}
      buttonProps={buttonProps}
    />
  );

  return { visibleColumns, columnConfigButton, visibleKeys };
}
