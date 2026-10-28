import React from 'react';
import { Move } from 'lucide-react';
import './CatalogOrderActions.css';
import { API, showError } from '../helpers';

const endpoints = {
  skills: '/api/skill/admin/reorder',
  experts: '/api/expert-web/admin/reorder',
  'skill-categories': '/api/skill-category/reorder',
  'expert-categories': '/api/expert/admin/categories/reorder',
};
const keyOf = item => String(item.key ?? item.id);

export async function moveCatalogItem(kind, item, target, after, reload) {
  if (!target || keyOf(item) === keyOf(target)) return;
  try {
    const response = await API.post(endpoints[kind], { key: keyOf(item), target_key: keyOf(target), after });
    if (!response.data?.success) throw new Error(response.data?.message || '保存顺序失败');
    await reload();
  } catch (error) { showError(error.response?.data?.message || error.message || '保存顺序失败'); }
}

const dragType = 'application/x-catalog-order';

function clearDropMarker(event) {
  delete event.currentTarget.dataset.catalogDrop;
}

// Rows are drop targets; only the dedicated handle starts a drag.
export function catalogDragProps(kind, item, reload) {
  return {
    'data-catalog-row': kind,
    onDragOver: event => {
      if (!Array.from(event.dataTransfer.types).includes(dragType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const bounds = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dataset.catalogDrop = event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
    },
    onDragLeave: clearDropMarker,
    onDrop: event => {
      event.preventDefault();
      clearDropMarker(event);
      const raw = event.dataTransfer.getData(dragType);
      if (!raw) return;
      let source;
      try { source = JSON.parse(raw); } catch { return; }
      if (!source || typeof source.key !== 'string' || source.kind !== kind) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      void moveCatalogItem(kind, { key: source.key }, item, event.clientY > bounds.top + bounds.height / 2, reload);
    },
  };
}

export default function CatalogOrderActions({ kind, item, items, reload, disabled = false }) {
  const index = items.findIndex(candidate => keyOf(candidate) === keyOf(item));
  return <span className='catalog-order-actions'>
    <button type='button' className='catalog-order-handle' draggable={!disabled} disabled={disabled}
      title='按住拖动排序；聚焦后可按上下方向键排序' aria-label='拖动排序'
      onClick={event => event.stopPropagation()}
      onDragStart={event => {
        event.stopPropagation();
        event.dataTransfer.setData(dragType, JSON.stringify({ kind, key: keyOf(item) }));
        event.dataTransfer.effectAllowed = 'move';
        const row = event.currentTarget.closest('[data-catalog-row]');
        if (row) {
          row.dataset.catalogDragging = 'true';
          event.dataTransfer.setDragImage?.(row, 24, row.getBoundingClientRect().height / 2);
        }
      }}
      onDragEnd={event => {
        delete event.currentTarget.closest('[data-catalog-row]')?.dataset.catalogDragging;
        document.querySelectorAll('[data-catalog-drop]').forEach(row => delete row.dataset.catalogDrop);
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        const after = event.key === 'ArrowDown';
        void moveCatalogItem(kind, item, items[index + (after ? 1 : -1)], after, reload);
      }}><Move size={18} strokeWidth={1.8} aria-hidden='true' /></button>
  </span>;
}
