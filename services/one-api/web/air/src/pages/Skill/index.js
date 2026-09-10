import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import SkillsTable from '../../components/SkillsTable';
import SkillCategory from '../SkillCategory';

const TABS = [
  ['public', '技能库'],
  ['categories', '分类管理']
];

const Skill = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(location.pathname === '/skill/categories' ? 'categories' : 'public');
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [categoryKeyword, setCategoryKeyword] = useState('');
  const libraryRef = useRef(null);
  const categoryRef = useRef(null);

  useEffect(() => {
    setActiveTab((prev) => {
      if (location.pathname === '/skill/categories') {
        return 'categories';
      }
      return prev === 'categories' ? 'public' : prev;
    });
  }, [location.pathname]);

  const handleTabChange = (key) => {
    setActiveTab(key);
    navigate(key === 'categories' ? '/skill/categories' : '/skill');
  };

  const toolbar =
    activeTab === 'categories' ? (
      <>
        <button type='button' className='preview-button primary' onClick={() => categoryRef.current?.openCreate()}>
          ＋ 新建分类
        </button>
        <Input
          className='skill-page-search'
          prefix={<IconSearch />}
          placeholder='搜索 code / 名称 / 描述 / 类型'
          value={categoryKeyword}
          onChange={setCategoryKeyword}
          style={{ width: 260 }}
          showClear
        />
      </>
    ) : (
      <>
        <button type='button' className='preview-button primary' onClick={() => libraryRef.current?.openCreate()}>
          ＋ 新建
        </button>
        <Input
          className='skill-page-search'
          prefix={<IconSearch />}
          placeholder='搜索名称 / 描述 / 上传人'
          value={libraryKeyword}
          onChange={(v) => {
            setLibraryKeyword(v);
            libraryRef.current?.onKeywordChange(v);
          }}
          style={{ width: 260 }}
          showClear
        />
      </>
    );

  return (
    <div className='zjugis-new-page'>
      <div className='preview-page-head'>
        <div>
          <div className='preview-kicker'>SKILL CENTER</div>
          <h1>技能管理</h1>
          <p>管理技能库技能和技能分类。</p>
        </div>
        <div className='skill-page-actions'>{toolbar}</div>
      </div>
      <div className='preview-tabs'>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type='button'
            className={activeTab === key ? 'active' : ''}
            onClick={() => handleTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'public' && <SkillsTable ref={libraryRef} keyword={libraryKeyword} />}
      {activeTab === 'categories' && (
        <section className='preview-surface skill-admin-surface'>
          <SkillCategory ref={categoryRef} embedded keyword={categoryKeyword} />
        </section>
      )}
    </div>
  );
};

export default Skill;
