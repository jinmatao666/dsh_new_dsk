import React from 'react';
import { Tag } from '@douyinfe/semi-ui';

export const SKILL_CATEGORY_TYPES = {
  package: 'skill_package',
  function: 'function_category'
};

export const SKILL_CATEGORY_TYPE_LABELS = {
  [SKILL_CATEGORY_TYPES.package]: '技能包',
  [SKILL_CATEGORY_TYPES.function]: '功能分类'
};

export const categorySelectOptions = (categories = [], typeCode) => {
  return categories
    .filter((category) => !typeCode || category.type_code === typeCode)
    .map((category) => ({
      label: category.name || category.code,
      value: category.id,
      typeCode: category.type_code,
      typeLabel: SKILL_CATEGORY_TYPE_LABELS[category.type_code] || category.type_name || category.type_code || '分类'
    }));
};

export const renderCategorySelectOption = (option) => {
  const { label, typeLabel, selected, className, style, onMouseEnter, onClick } = option;
  return (
    <div
      className={className}
      style={{
        ...style,
        boxSizing: 'border-box',
        minHeight: 40,
        padding: '8px 12px'
      }}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ width: 18, flex: '0 0 18px', fontSize: 18, lineHeight: 1 }}>
          {selected ? '✓' : ''}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <Tag color='light-blue' size='small'>
          {typeLabel}
        </Tag>
      </div>
    </div>
  );
};

export const renderCategorySelectedItem = (option) => ({
  isRenderInTag: true,
  content: option.label
});

export const renderSkillCategoryTags = (categories = []) => {
  if (!categories.length) {
    return <span style={{ color: '#aaa' }}>-</span>;
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {categories.map((category) => (
        <Tag
          key={category.id}
          color={category.type_code === SKILL_CATEGORY_TYPES.package ? 'blue' : 'green'}
        >
          {category.name || category.code}
        </Tag>
      ))}
    </div>
  );
};
