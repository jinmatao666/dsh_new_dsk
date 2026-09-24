import React, { useState } from 'react';
import ExpertTable from '../../components/ExpertTable';
import ExpertCategory from '../../components/ExpertCategory';
import './index.css';

const tabs = [
  ['experts', '专家'],
  ['teams', '专家团'],
  ['categories', '分类管理']
];

export default function Expert() {
  const [active, setActive] = useState('experts');
  return <div className='expert-page'>
    <header className='expert-page-header'>
      <span>EXPERT CENTER</span>
      <h1>专家管理</h1>
      <p>管理桌面端专家与专家团的展示资料、分类和上架状态。</p>
    </header>
    <nav className='expert-page-tabs' aria-label='专家管理内容'>
      {tabs.map(([key, label]) => <button type='button' key={key} className={active === key ? 'active' : ''} onClick={() => setActive(key)}>{label}</button>)}
    </nav>
    <section className='expert-page-surface'>
      {active === 'experts' && <ExpertTable />}
      {active === 'teams' && <div className='expert-team-empty'><div>暂无已开发的专家团工作台</div><p>专家团将沿用专家的资料、分类、图标和上下架管理方式；代码交付工作台后才会出现在这里。</p></div>}
      {active === 'categories' && <ExpertCategory />}
    </section>
  </div>;
}
