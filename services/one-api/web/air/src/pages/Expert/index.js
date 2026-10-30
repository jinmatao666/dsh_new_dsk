import React, { useState } from 'react';
import ExpertWebTable from '../../components/ExpertWebTable';
import ExpertCategory from '../../components/ExpertCategory';
import './index.css';
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';

const tabs = [
  ['websites', '专家'],
  ['categories', '分类管理']
];

export default function Expert() {
  const [active, setActive] = useState('websites');
  const [keyword, setKeyword] = useState('');
  return <div className='expert-page'>
    <header className='expert-page-header'>
      <span>EXPERT CENTER</span>
      <h1>专家管理</h1>
      <p>管理独立部署的专家网站、展示资料和分类。</p>
      {active === 'websites' && <Input className='expert-page-search' prefix={<IconSearch />} aria-label='搜索专家' placeholder='搜索名称 / 描述 / 提供方' value={keyword} onChange={setKeyword} showClear />}
    </header>
    <nav className='expert-page-tabs' aria-label='专家管理内容'>
      {tabs.map(([key, label]) => <button type='button' key={key} className={active === key ? 'active' : ''} onClick={() => setActive(key)}>{label}</button>)}
    </nav>
    <section className='expert-page-surface'>
      {active === 'websites' && <ExpertWebTable keyword={keyword} />}
      {active === 'categories' && <ExpertCategory />}
    </section>
  </div>;
}
