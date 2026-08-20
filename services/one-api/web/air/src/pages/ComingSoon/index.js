import React from 'react';
import { Hourglass } from 'lucide-react';

// 「敬请期待」产品的占位首页：暂无内容，仅展示空状态提示。
const ComingSoon = () => (
  <div className="product-empty-hint" style={{ minHeight: '60vh', justifyContent: 'center' }}>
    <Hourglass size={32} strokeWidth={1.5} />
    <div className="product-empty-hint-title">敬请期待</div>
    <div className="product-empty-hint-desc">该产品后台正在建设中</div>
  </div>
);

export default ComingSoon;
