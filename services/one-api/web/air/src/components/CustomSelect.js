import React, { useEffect, useRef, useState } from 'react';

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

const CustomSelect = React.forwardRef(function CustomSelect(
  { value, onChange, children, placeholder = '请选择', className = '', id, disabled = false },
  ref
) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const currentValue = String(value ?? '');
  const options = React.Children.toArray(children).map((child) => {
    const optionValue = child.props.value != null ? String(child.props.value) : '';
    return { value: optionValue, label: flattenChildren(child.props.children) || optionValue };
  });
  const current = options.find((option) => option.value === currentValue);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (optionValue) => {
    setOpen(false);
    if (onChange) onChange({ target: { value: optionValue } });
  };

  return (
    <div ref={rootRef} id={id} className={`zjugis-select${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type='button'
        ref={ref}
        className='zjugis-select-trigger'
        disabled={disabled}
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className={current ? undefined : 'is-placeholder'}>{current ? current.label : placeholder}</span>
        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='m6 9 6 6 6-6' /></svg>
      </button>
      {open && (
        <div className='zjugis-select-menu' role='listbox'>
          {options.map((option) => (
            <button
              key={option.value}
              type='button'
              role='option'
              aria-selected={option.value === currentValue}
              className={`zjugis-select-option${option.value === currentValue ? ' active' : ''}`}
              onClick={() => pick(option.value)}
            >
              <span>{option.label}</span>
              {option.value === currentValue && (
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M20 6 9 17l-5-5' /></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default CustomSelect;
