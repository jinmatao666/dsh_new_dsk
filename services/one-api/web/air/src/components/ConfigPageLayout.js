import React from 'react';
import { Button } from 'semantic-ui-react';
import { Tabs, TabPane } from '@douyinfe/semi-ui';

export const ConfigPageLayout = ({ children, className = '' }) => {
  const layoutClassName = ['config-page-layout', className].filter(Boolean).join(' ');
  return <div className={layoutClassName}>{children}</div>;
};

export const ConfigPageTabs = ({ className = '', sticky = true, ...props }) => {
  const tabsClassName = [
    'config-page-tabs',
    sticky ? 'config-page-tabs-sticky parvis-tabs' : '',
    className
  ].filter(Boolean).join(' ');
  return <Tabs type="line" className={tabsClassName} {...props} />;
};

export const ConfigPageTabPane = TabPane;

export const ConfigPageFooter = ({
  dirty = false,
  loading = false,
  hint,
  saveText = '保存设置',
  cancelText = '取消',
  onSave,
  onCancel
}) => {
  const footerClassName = `config-page-footer${dirty ? ' is-dirty' : ''}`;

  return (
    <div className={footerClassName}>
      <span className="config-page-footer-hint">
        {hint || (dirty ? '有未保存的修改' : '所有修改已保存')}
      </span>
      <div className="config-page-footer-actions">
        <Button
          type="button"
          disabled={!dirty || loading}
          onClick={onCancel}
        >
          {cancelText}
        </Button>
        <Button
          primary
          type="button"
          loading={loading}
          disabled={!dirty}
          onClick={onSave}
        >
          {saveText}
        </Button>
      </div>
    </div>
  );
};
