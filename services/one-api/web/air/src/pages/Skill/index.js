import React, { useEffect, useRef, useState } from 'react';
import { Input, Button, Space } from '@douyinfe/semi-ui';
import { IconSearch, IconPlus, IconUpload } from '@douyinfe/semi-icons';
import { useLocation, useNavigate } from 'react-router-dom';
import SkillsTable from '../../components/SkillsTable';
import PersonalSkillsTable from '../../components/PersonalSkillsTable';
import { ConfigPageTabPane, ConfigPageTabs } from '../../components/ConfigPageLayout';
import SkillCategory from '../SkillCategory';

const Skill = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(location.pathname === '/skill/categories' ? 'categories' : 'public');
  const [publicKeyword, setPublicKeyword] = useState('');
  const [personalKeyword, setPersonalKeyword] = useState('');
  const [categoryKeyword, setCategoryKeyword] = useState('');
  const publicRef = useRef(null);
  const personalRef = useRef(null);
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

  const toolbar = activeTab === 'categories' ? (
    <Space>
      <Button
        icon={<IconPlus />}
        theme='solid'
        type='primary'
        onClick={() => categoryRef.current?.openCreate()}
      >
        新建分类
      </Button>
      <Input
        prefix={<IconSearch />}
        placeholder='搜索 code / 名称 / 描述 / 类型'
        value={categoryKeyword}
        onChange={setCategoryKeyword}
        style={{ width: 280 }}
        showClear
      />
    </Space>
  ) : activeTab === 'public' ? (
    <Space>
      <Button
        icon={<IconPlus />}
        theme='solid'
        type='primary'
        onClick={() => publicRef.current?.openCreate()}
      >
        新建
      </Button>
      <Button
        icon={<IconUpload />}
        onClick={() => publicRef.current?.openBatchImport()}
      >
        批量导入
      </Button>
      <Input
        prefix={<IconSearch />}
        placeholder='搜索 name / description / submitter'
        value={publicKeyword}
        onChange={(v) => {
          setPublicKeyword(v);
          publicRef.current?.onKeywordChange(v);
        }}
        style={{ width: 280 }}
        showClear
      />
    </Space>
  ) : (
    <Space>
      <Button
        icon={<IconPlus />}
        theme='solid'
        type='primary'
        onClick={() => personalRef.current?.openCreate()}
      >
        新建
      </Button>
      <Input
        prefix={<IconSearch />}
        placeholder='搜索 name / description / owner'
        value={personalKeyword}
        onChange={(v) => {
          setPersonalKeyword(v);
          personalRef.current?.onKeywordChange(v);
        }}
        style={{ width: 280 }}
        showClear
      />
    </Space>
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        margin: '-12px -24px 0'
      }}
    >
      <ConfigPageTabs
        activeKey={activeTab}
        onChange={handleTabChange}
        sticky={false}
        lazyRender
        keepDOM={false}
        className='skill-tabs'
        tabBarExtraContent={toolbar ? <div style={{ paddingRight: 24 }}>{toolbar}</div> : null}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
        tabBarStyle={{
          flexShrink: 0,
          padding: '0 24px',
          marginBottom: 0,
          background: 'var(--semi-color-bg-0)',
          borderBottom: '1px solid var(--semi-color-border)'
        }}
        contentStyle={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          padding: '12px 24px'
        }}
      >
        <ConfigPageTabPane tab='公库' itemKey='public' style={{ height: '100%' }}>
          <SkillsTable ref={publicRef} keyword={publicKeyword} />
        </ConfigPageTabPane>
        <ConfigPageTabPane tab='私库' itemKey='personal' style={{ height: '100%' }}>
          <PersonalSkillsTable ref={personalRef} keyword={personalKeyword} />
        </ConfigPageTabPane>
        <ConfigPageTabPane tab='分类管理' itemKey='categories' style={{ height: '100%' }}>
          <SkillCategory ref={categoryRef} embedded keyword={categoryKeyword} />
        </ConfigPageTabPane>
      </ConfigPageTabs>
    </div>
  );
};

export default Skill;
