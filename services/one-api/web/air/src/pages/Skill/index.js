import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import SkillsTable from '../../components/SkillsTable';
import SkillCategory from '../SkillCategory';
import SkillReviewTable from '../../components/SkillReviewTable';
import { API, isRoot } from '../../helpers';

const TABS = [
  ['public', '技能库'],
  ['categories', '分类管理'],
  ['reviews', '技能审核']
];

const Skill = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canReview = isRoot();
  const [activeTab, setActiveTab] = useState(location.pathname === '/skill/categories' ? 'categories' : location.pathname === '/skill/reviews' && canReview ? 'reviews' : 'public');
  const [libraryKeyword, setLibraryKeyword] = useState('');
  const [categoryKeyword, setCategoryKeyword] = useState('');
  const [pendingReviewCount, setPendingReviewCount] = useState(null);
  const libraryRef = useRef(null);
  const categoryRef = useRef(null);
  const reviewRef = useRef(null);
  const handleReviewCountsChange = useCallback(counts => setPendingReviewCount(counts.pending), []);

  useEffect(() => {
    setActiveTab((prev) => {
      if (location.pathname === '/skill/categories') {
        return 'categories';
      }
      if (location.pathname === '/skill/reviews' && canReview) return 'reviews';
      return prev === 'categories' || prev === 'reviews' ? 'public' : prev;
    });
  }, [location.pathname, canReview]);

  useEffect(() => {
    if (!canReview) return;
    void API.get('/api/personal-skill/admin/reviews', { params: { page: 1, perPage: 1, status: 'pending' } })
      .then(response => setPendingReviewCount(Number(response.data?.totalItems || 0)))
      .catch(() => {});
  }, [canReview]);

  const handleTabChange = (key) => {
    setActiveTab(key);
    navigate(key === 'categories' ? '/skill/categories' : key === 'reviews' ? '/skill/reviews' : '/skill');
  };

  const toolbar = activeTab === 'reviews' ? (
    <Input
      className='skill-page-search'
      prefix={<IconSearch />}
      placeholder='搜索技能 / 上传人'
      onChange={value => reviewRef.current?.onKeywordChange(value)}
      style={{ width: 260 }}
      showClear
    />
  ) :
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
          <p>管理技能库、技能分类和用户投稿审核。</p>
        </div>
        <div className='skill-page-actions'>{toolbar}</div>
      </div>
      <div className='preview-tabs'>
        {TABS.filter(([key]) => key !== 'reviews' || canReview).map(([key, label]) => (
          <button
            key={key}
            type='button'
            className={activeTab === key ? 'active' : ''}
            onClick={() => handleTabChange(key)}
          >
            <span>{label}</span>
            {key === 'reviews' && pendingReviewCount !== null && pendingReviewCount > 0 && <b className='skill-count-badge pending'>{pendingReviewCount > 99 ? '99+' : pendingReviewCount}</b>}
          </button>
        ))}
      </div>
      {activeTab === 'public' && <SkillsTable ref={libraryRef} keyword={libraryKeyword} />}
      {activeTab === 'categories' && (
        <section className='preview-surface skill-admin-surface'>
          <SkillCategory ref={categoryRef} embedded keyword={categoryKeyword} />
        </section>
      )}
      {activeTab === 'reviews' && <SkillReviewTable ref={reviewRef} onCountsChange={handleReviewCountsChange} />}
    </div>
  );
};

export default Skill;
