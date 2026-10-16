import React from 'react';
import { hasPermission } from '../helpers';
import { Empty } from '@douyinfe/semi-ui';
import { ShieldOff } from 'lucide-react';

const PermissionGuard = ({ permKey, children }) => {
  if (!hasPermission(permKey)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
        gap: 12,
        color: 'var(--semi-color-text-2)',
      }}>
        <ShieldOff size={36} strokeWidth={1.5} style={{ color: 'var(--semi-color-text-3)' }} />
        <div style={{ fontSize: 14 }}>暂无权限</div>
        <div style={{ fontSize: 12, color: 'var(--semi-color-text-3)' }}>请联系超管开通此功能的访问权限</div>
      </div>
    );
  }
  return children;
};

export default PermissionGuard;
