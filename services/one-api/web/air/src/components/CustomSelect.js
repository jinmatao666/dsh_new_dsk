import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 统一自定义下拉：触发器与 .zjugis-field 输入框同款圆角样式，
// 弹层为页面内浮层（白底圆角 + 柔和阴影），替代系统原生 select 弹层。
// children 仍接收 <option value=...>label</option>，onChange 收到
// 合成事件 { target: { value } }，与原生 select 的回调写法完全兼容。

const flattenChildren = (node) => {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenChildren).join('');
  if (node.props && 'children' in node.props) return flattenChildren(node.props.children);
  return '';
};

const collectOptions = (children, groupDisabled = false) => React.Children.toArray(children).flatMap(child => {
  if (!React.isValidElement(child)) return [];
  if (child.type === React.Fragment || child.type === 'optgroup') {
    return collectOptions(child.props.children, groupDisabled || Boolean(child.props.disabled));
  }
  const label = flattenChildren(child.props.children);
  const value = child.props.value == null ? label : String(child.props.value);
  return [{ value, label: label || value, disabled: groupDisabled || Boolean(child.props.disabled) }];
});

const CustomSelect = React.forwardRef(function CustomSelect(
  { value, onChange, children, placeholder = '请选择', className = '', id, style, disabled = false,
    'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy },
  ref
) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const menuID = useId();
  const [position, setPosition] = useState(null);
  const keyboardOpen = useRef(false);
  const currentValue = String(value ?? '');
  const options = collectOptions(children);
  const current = options.find((option) => option.value === currentValue);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      const below = viewportHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const flip = below < Math.min(264, options.length * 38 + 12) && above > below;
      const maxHeight = Math.max(40, Math.min(264, flip ? above : below));
      const height = Math.min(menuRef.current?.scrollHeight || maxHeight, maxHeight);
      const width = Math.min(rect.width, viewport - 16);
      setPosition({ position: 'fixed', width, left: Math.max(8, Math.min(rect.left, viewport - width - 8)),
        top: flip ? Math.max(8, rect.top - height - 6) : rect.bottom + 6, right: 'auto', maxHeight });
    };
    const onScroll = event => { if (!menuRef.current?.contains(event.target)) measure(); };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
      observer?.disconnect();
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    if (keyboardOpen.current) {
      keyboardOpen.current = false;
      const selected = menuRef.current?.querySelector('[role="option"][aria-selected="true"]:not(:disabled)');
      (selected || menuRef.current?.querySelector('[role="option"]:not(:disabled)'))?.focus();
    }
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { setOpen(false); rootRef.current?.querySelector('.zjugis-select-trigger')?.focus(); }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (optionValue) => {
    setOpen(false);
    rootRef.current?.querySelector('.zjugis-select-trigger')?.focus();
    if (onChange) onChange({ target: { value: optionValue } });
  };

  return (
    <div ref={rootRef} style={style} className={`zjugis-select${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
      onKeyDown={event => {
        if (open && event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); return;
        }
        if (disabled || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (!open) { keyboardOpen.current = true; setOpen(true); return; }
        const items = [...menuRef.current.querySelectorAll('[role="option"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <button
        type='button'
        id={id}
        ref={node => { triggerRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; }}
        className='zjugis-select-trigger'
        disabled={disabled}
        aria-haspopup='listbox'
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-controls={open ? menuID : undefined}
        value={currentValue}
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className={current ? undefined : 'is-placeholder'}>{current ? current.label : placeholder}</span>
        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='m6 9 6 6 6-6' /></svg>
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuID} className='zjugis-select-menu' role='listbox' aria-label={ariaLabel}
          style={position || { visibility: 'hidden' }}>
          {options.map((option, index) => (
            <button
              key={`${option.value}-${index}`}
              type='button'
              role='option'
              aria-selected={option.value === currentValue}
              disabled={disabled || option.disabled}
              value={option.value}
              className={`zjugis-select-option${option.value === currentValue ? ' active' : ''}`}
              onClick={event => { event.stopPropagation(); pick(option.value); }}
            >
              <span>{option.label}</span>
              {option.value === currentValue && (
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M20 6 9 17l-5-5' /></svg>
              )}
            </button>
          ))}
          {options.length === 0 && <div className='zjugis-select-empty'>暂无选项</div>}
        </div>, document.body
      )}
    </div>
  );
});

export default CustomSelect;
