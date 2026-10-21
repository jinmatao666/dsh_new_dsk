import React, { useId, useRef, useState } from 'react';
import { API } from '../../helpers';
import './ChannelModelTools.css';

export const channelModelNames = (channel) => [...new Set(String(channel?.models || '').split(/[,\n\r]/).map(name => name.trim()).filter(Boolean))];
export const filterModelSources = (model, channel) => (model.sources || []).filter(source => channel === 'all' || String(source.channel_id) === channel);
export const filterChannelModels = (models, channel) => models.filter(model => channel === 'all' || (channel === 'unbound' ? !(model.sources || []).length : filterModelSources(model, channel).length > 0));

// 模型 ID 只能从渠道清单选择；搜索文字不作为可保存的模型 ID。
export function ChannelModelPicker({ names, value, onChange, disabled }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const options = names.filter(name => name.toLowerCase().includes(query.toLowerCase()));
  const pick = name => { onChange(name); setOpen(false); setQuery(''); };
  return <div className='channel-model-picker'>
    <input role='combobox' aria-label='模型 ID' aria-expanded={open} aria-controls={id} aria-autocomplete='list'
      aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
      disabled={disabled} value={open ? query : value} placeholder={disabled ? '请先选择来源渠道' : '搜索并选择渠道模型'}
      onFocus={() => { setOpen(true); setQuery(''); setActive(0); }}
      onBlur={() => setOpen(false)} onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); setOpen(true);
          setActive(current => Math.max(0, Math.min(options.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1))));
        }
        if (e.key === 'Enter' && open) { e.preventDefault(); if (options[active]) pick(options[active]); }
      }} />
    {open && !disabled && <div id={id} role='listbox' aria-label='渠道模型清单' className='channel-model-picker-menu'>
      {options.map((name, index) => <button type='button' role='option' id={`${id}-${index}`} key={name} aria-selected={value === name}
        className={index === active ? 'active' : ''} onMouseDown={e => e.preventDefault()} onClick={() => pick(name)}>{name}</button>)}
      {options.length === 0 && <p>无匹配模型，请先在渠道设置中维护模型清单。</p>}
    </div>}
  </div>;
}

export function ChannelModelBatch({ channels, definitions, defaultContext, Modal, onClose, onSaved }) {
  const [channelID, setChannelID] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [drafts, setDrafts] = useState(null);
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const channel = channels.find(item => String(item.id) === channelID);
  const names = channelModelNames(channel);
  const existing = name => definitions.find(item => item.name === name && item.id);
  const bound = name => Boolean(existing(name) && filterModelSources(existing(name), channelID).length);
  const filtered = names.filter(name => name.toLowerCase().includes(query.toLowerCase()));
  const available = filtered.filter(name => !bound(name));
  const update = (name, key, value) => setDrafts(current => current.map(item => item.name === name ? { ...item, [key]: value } : item));
  const close = () => { if (!pending.current) onClose(); };
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    const next = { ...results };
    try {
      for (const item of drafts) {
        if (next[item.name]?.success) continue;
        try {
          if (['context_limit', 'model_ratio', 'completion_ratio'].some(key => !Number.isFinite(Number(item[key])) || Number(item[key]) < 0)
            || !Number.isInteger(Number(item.context_limit))) throw new Error('上下文应为非负整数，倍率应为非负数');
          const response = await API.post('/api/model_definition/from_channel', {
            channel_id: Number(channelID), definition: { name: item.name, display_name: item.display_name, model_type: item.model_type, context_limit: Number(item.context_limit) },
            model_ratio: Number(item.model_ratio), completion_ratio: Number(item.completion_ratio),
          }, { timeout: 30000 });
          if (!response.data?.success) throw new Error(response.data?.message || '登记失败');
          next[item.name] = { success: true, message: ({ created: '已新增（默认禁用）', bound: '已绑定，保留原配置', skipped: '已存在，已跳过' })[response.data.status] || '已保存' };
        } catch (error) {
          next[item.name] = { success: false, message: error.code === 'ECONNABORTED' ? '结果未确认，可重试核实；不会重复创建' : error.message || '登记失败' };
        }
        setResults({ ...next });
      }
      await onSaved();
    } finally { pending.current = false; setBusy(false); }
  };
  return <Modal wide title='从渠道批量添加模型' onClose={close}>
    <div className='channel-model-batch'>
      {!drafts ? <>
        <label className='zjugis-field'><span>来源渠道</span><select aria-label='批量来源渠道' value={channelID} onChange={e => { setChannelID(e.target.value); setSelected([]); setQuery(''); }}>
          <option value=''>请选择来源渠道</option>{channels.map(item => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}
        </select></label>
        <p className='preview-muted'>候选来自渠道已配置清单，不代表已获上游调用授权；默认不勾选。</p>
        <input aria-label='搜索批量模型' placeholder='搜索模型 ID' value={query} onChange={e => setQuery(e.target.value)} disabled={!channelID} />
        <div className='channel-model-bulk-toolbar'><span>已选 {selected.length} 个</span>
          <button type='button' disabled={!available.length} onClick={() => setSelected(current => [...new Set([...current, ...available])])}>全选</button>
          <button type='button' disabled={!available.length} onClick={() => setSelected(current => [...current.filter(name => !available.includes(name)), ...available.filter(name => !current.includes(name))])}>反选</button>
        </div>
        <div className='channel-model-batch-list'>{filtered.map(name => <label key={name}>
          <input type='checkbox' checked={selected.includes(name)} disabled={bound(name)} onChange={() => setSelected(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])} />
          <span>{name}</span><small>{bound(name) ? '已添加' : existing(name) ? '已有定义，仅补绑定' : '新模型'}</small>
        </label>)}{channelID && !filtered.length && <p>没有匹配模型，请先维护渠道模型清单。</p>}</div>
        <div className='zjugis-modal-actions'><button className='preview-button' onClick={close}>取消</button>
          <button className='preview-button primary' disabled={!selected.length} onClick={() => setDrafts(selected.map(name => {
            const definition = existing(name);
            return { name, display_name: definition?.display_name || name, model_type: definition?.model_type || 'chat', context_limit: definition?.context_limit || defaultContext || 0, model_ratio: definition?.model_ratio ?? 0, completion_ratio: definition?.completion_ratio ?? 0 };
          }))}>下一步</button></div>
      </> : <>
        <p>来源渠道：{channel?.name}。新模型默认禁用；已有定义只新增绑定，不覆盖原配置。倍率为 0 表示免费，请确认后再启用。</p>
        <div className='preview-table-wrap'><table className='preview-table channel-model-batch-table'><thead><tr><th>模型 ID</th><th>显示名称</th><th>类型</th><th>上下文</th><th>输入倍率</th><th>补全倍率</th><th>结果</th></tr></thead><tbody>
          {drafts.map(item => <tr key={item.name}><td>{item.name}</td>
            {['display_name', 'model_type', 'context_limit', 'model_ratio', 'completion_ratio'].map(key => <td key={key}>{key === 'model_type'
              ? <select aria-label={`${item.name} 类型`} value={item[key]} disabled={busy || Boolean(existing(item.name)) || results[item.name]?.success} onChange={e => update(item.name, key, e.target.value)}>{['chat', 'image', 'audio', 'embedding', 'other'].map(type => <option key={type}>{type}</option>)}</select>
              : <input aria-label={`${item.name} ${key}`} type={key === 'display_name' ? 'text' : 'number'} min={0} step='any' value={item[key]} disabled={busy || Boolean(existing(item.name)) || results[item.name]?.success} onChange={e => update(item.name, key, e.target.value)} />}</td>)}
            <td aria-live='polite'>{results[item.name]?.message || (existing(item.name) ? '保留已有配置' : '待保存')}</td></tr>)}
        </tbody></table></div>
        <div className='zjugis-modal-actions'>
          {!Object.keys(results).length && <button className='preview-button' disabled={busy} onClick={() => setDrafts(null)}>上一步</button>}
          <button className='preview-button' disabled={busy} onClick={close}>{Object.keys(results).length ? '关闭' : '取消'}</button>
          <button className='preview-button primary' disabled={busy || drafts.every(item => results[item.name]?.success)} onClick={save}>{busy ? '正在保存…' : Object.keys(results).length ? '重试失败项' : '批量保存'}</button>
        </div>
      </>}
    </div>
  </Modal>;
}
