import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Modal, Table, Tag, TextArea } from '@douyinfe/semi-ui';
import SkillBrowseDrawer from './SkillBrowseDrawer';
import { API, showError, showSuccess, timestamp2string } from '../helpers';
import './SkillsTable.css';

const STATUS = {
  pending: ['待审核', 'orange'],
  approved: ['已通过', 'green'],
  rejected: ['已驳回', 'red']
};

const SkillReviewTable = forwardRef(({ keyword: keywordProp = '' }, ref) => {
  const [items, setItems] = useState([]);
  const [keyword, setKeyword] = useState(keywordProp);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [browse, setBrowse] = useState({ visible: false, skill: null });
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/personal-skill/admin/reviews', {
        params: { page, perPage: 20, keyword, status }
      });
      const loaded = Array.isArray(response.data?.items) ? response.data.items : [];
      setItems(loaded);
      setTotal(Number(response.data?.totalItems || 0));
    } catch (error) {
      setItems([]);
      setTotal(0);
      showError(error.message || '加载技能审核列表失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, page, status]);

  useEffect(() => { void load(); }, [load]);
  useImperativeHandle(ref, () => ({
    onKeywordChange: value => { setKeyword(value || ''); setPage(1); }
  }));

  const review = async (skill, action, reviewReason = '') => {
    try {
      const response = await API.post(`/api/personal-skill/admin/${skill.id}/review/${action}`, { reason: reviewReason });
      if (response.data?.success === false) throw new Error(response.data.message || '审核失败');
      showSuccess(action === 'approve' ? '审核通过，技能已发布' : '已驳回该技能');
      setRejecting(null);
      setReason('');
      await load();
    } catch (error) {
      showError(error.message || '审核失败');
    }
  };

  const approve = skill => Modal.confirm({
    title: skill.published_skill_id ? '确认通过技能更新？' : '确认发布该技能？',
    content: skill.published_skill_id
      ? '通过后，新版本将覆盖技能市场中的现有版本。审核完成前，用户仍使用当前线上版本。'
      : '通过后，该个人技能会立即进入技能市场。',
    okText: '审核通过',
    cancelText: '取消',
    onOk: () => review(skill, 'approve')
  });

  const columns = [
    {
      title: '技能', dataIndex: 'display_name', width: 260,
      render: (_, skill) => <div className='skill-review-identity'>
        <strong>{skill.display_name || skill.name}</strong>
        <span>{skill.name} · v{skill.version || '1.0.0'}</span>
      </div>
    },
    { title: '上传人', dataIndex: 'owner', width: 150 },
    { title: '分类', dataIndex: 'category', width: 120, render: value => value || '通用类' },
    {
      title: '审核类型', width: 100,
      render: (_, skill) => <Tag color={skill.published_skill_id ? 'blue' : 'cyan'}>{skill.published_skill_id ? '更新' : '首次发布'}</Tag>
    },
    {
      title: '提交时间', dataIndex: 'submitted_at', width: 160,
      render: value => value ? timestamp2string(value) : '-'
    },
    {
      title: '状态', dataIndex: 'review_status', width: 100,
      render: value => { const entry = STATUS[value] || [value || '-', 'grey']; return <Tag color={entry[1]}>{entry[0]}</Tag>; }
    },
    {
      title: '操作', width: 160,
      render: (_, skill) => <div className='skill-review-actions'>
        <button type='button' className='skill-text-action' onClick={() => setBrowse({ visible: true, skill })}>浏览</button>
        {skill.review_status === 'pending' && <>
          <button type='button' className='skill-text-action' onClick={() => approve(skill)}>通过</button>
          <button type='button' className='skill-text-action danger' onClick={() => { setRejecting(skill); setReason(''); }}>驳回</button>
        </>}
      </div>
    }
  ];

  return <section className='preview-surface skill-admin-surface skill-review-surface'>
    <div className='skill-review-summary'>
      <div><strong>{total}</strong><span>{status === 'pending' ? '待审核投稿' : '条审核记录'}</span></div>
      <div className='skill-review-filters'>
        {Object.entries(STATUS).map(([key, entry]) => <button key={key} type='button' className={status === key ? 'active' : ''} onClick={() => { setStatus(key); setPage(1); }}>{entry[0]}</button>)}
        <button type='button' className={status === 'all' ? 'active' : ''} onClick={() => { setStatus('all'); setPage(1); }}>全部</button>
      </div>
    </div>
    <Table
      rowKey='id'
      columns={columns}
      dataSource={items}
      loading={loading}
      pagination={{ currentPage: page, pageSize: 20, total, onPageChange: setPage, showSizeChanger: false }}
      empty='暂无技能审核记录'
    />
    <SkillBrowseDrawer visible={browse.visible} kind='personal' id={browse.skill?.id} skill={browse.skill} onClose={() => setBrowse({ visible: false, skill: null })} />
    <Modal
      title='驳回技能投稿'
      visible={rejecting !== null}
      okText='确认驳回'
      cancelText='取消'
      okButtonProps={{ type: 'danger', disabled: reason.trim() === '' }}
      onCancel={() => { setRejecting(null); setReason(''); }}
      onOk={() => { if (rejecting) void review(rejecting, 'reject', reason.trim()); }}
    >
      <p className='skill-review-reject-copy'>请说明需要修改的内容，用户可调整后重新提交审核。</p>
      <TextArea value={reason} onChange={setReason} maxCount={500} rows={4} placeholder='填写驳回原因' />
    </Modal>
  </section>;
});

export default SkillReviewTable;
