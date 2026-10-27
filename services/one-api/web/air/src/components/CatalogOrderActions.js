import React from 'react';
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

export function catalogDragProps(kind, item, reload) {
  return {
    draggable: true,
    title: '拖动调整顺序，也可使用上移和下移按钮',
    onDragStart: event => { event.dataTransfer.setData('application/x-catalog-order', JSON.stringify({ kind, key: keyOf(item) })); event.dataTransfer.effectAllowed = 'move'; },
    onDragOver: event => { if (Array.from(event.dataTransfer.types).includes('application/x-catalog-order')) event.preventDefault(); },
    onDrop: event => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/x-catalog-order');
      if (!raw) return;
      let source;
      try { source = JSON.parse(raw); } catch { return; }
      if (!source || typeof source.key !== 'string') return;
      if (source.kind !== kind) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      void moveCatalogItem(kind, { key: source.key }, item, event.clientY > bounds.top + bounds.height / 2, reload);
    },
  };
}

export default function CatalogOrderActions({ kind, item, items, reload }) {
  const index = items.findIndex(candidate => keyOf(candidate) === keyOf(item));
  return <span className='catalog-order-actions' style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
    <button type='button' disabled={index <= 0} title='上移' aria-label='上移' onClick={() => void moveCatalogItem(kind, item, items[index - 1], false, reload)}>↑</button>
    <button type='button' disabled={index < 0 || index >= items.length - 1} title='下移' aria-label='下移' onClick={() => void moveCatalogItem(kind, item, items[index + 1], true, reload)}>↓</button>
  </span>;
}
