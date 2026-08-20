import React from 'react';
import { Button, Checkbox, Dropdown } from '@douyinfe/semi-ui';
import { SlidersHorizontal } from 'lucide-react';

/**
 * 统一的「列配置」下拉选择器。
 * 勾选/取消即时生效,固定列(always)恒勾选且禁用。
 *
 * @param {Array<{key:string,label:string,always?:boolean}>} columnMeta 列元信息
 * @param {string[]} visibleKeys 当前可见列 key
 * @param {(key:string, checked:boolean)=>void} onToggle 切换回调
 * @param {object} [buttonProps] 透传给触发按钮的属性(theme/type/style 等)
 */
const ColumnSelector = ({ columnMeta, visibleKeys, onToggle, buttonProps = {} }) => {
  const {
    theme = 'light',
    type = 'tertiary',
    style,
    children = '列配置',
    ...restButtonProps
  } = buttonProps;

  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      render={
        <Dropdown.Menu>
          {columnMeta.map((col) => (
            <Dropdown.Item key={col.key}>
              <Checkbox
                disabled={col.always}
                checked={col.always || visibleKeys.includes(col.key)}
                onChange={(e) => onToggle(col.key, e.target.checked)}
              >
                {col.label}
              </Checkbox>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <Button
        icon={<SlidersHorizontal size={16} />}
        theme={theme}
        type={type}
        style={style}
        {...restButtonProps}
      >
        {children}
      </Button>
    </Dropdown>
  );
};

export default ColumnSelector;
