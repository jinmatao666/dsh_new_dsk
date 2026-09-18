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

const REVIEW_MOCKS = [
  { id: -1, mock: true, name: 'meeting-minutes-pro', display_name: '会议纪要整理助手', version: '1.0.0', owner: '张明 · 市场部', category: '办公文档', description: '将会议录音转写稿整理为结构化会议纪要，并提取决策、待办和责任人。', body: '# 会议纪要整理助手\n\n整理会议材料并输出结构化纪要。', review_status: 'pending', submitted_at: Math.floor(Date.now() / 1000) - 1800 },
  { id: -2, mock: true, name: 'excel-ledger-cleaner', display_name: 'Excel 台账清洗', version: '1.2.0', published_skill_id: 18, owner: '李雪 · 财务部', category: '数据分析', description: '批量处理台账中的重复记录、空值、日期和金额格式。', body: '# Excel 台账清洗\n\n清理并统一 Excel 台账格式。', review_status: 'pending', submitted_at: Math.floor(Date.now() / 1000) - 7200 },
  { id: -3, mock: true, name: 'contract-risk-check', display_name: '合同风险检查', version: '1.0.0', owner: '王磊 · 法务部', category: '办公文档', description: '识别合同中的付款、违约、期限和责任条款风险。', body: '# 合同风险检查\n\n检查合同关键条款与潜在风险。', review_status: 'approved', submitted_at: Math.floor(Date.now() / 1000) - 86400 }
];

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
      const visible = status === 'all' ? REVIEW_MOCKS : REVIEW_MOCKS.filter(item => item.review_status === status);
      setItems(process.env.NODE_ENV === 'development' && loaded.length === 0 ? visible : loaded);
      setTotal(process.env.NODE_ENV === 'development' && loaded.length === 0 ? visible.length : Number(response.data?.totalItems || 0));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        const visible = status === 'all' ? REVIEW_MOCKS : REVIEW_MOCKS.filter(item => item.review_status === status);
        setItems(visible);
        setTotal(visible.length);
      } else {
        showError(error.message || '加载技能审核列表失败');
      }
    } finally {
      setLoading(false);
    }
  }, [keyword, page, status]);

  useEffect(() => { void load(); }, [load]);
  useImperativeHandle(ref, () => ({
    onKeywordChange: value => { setKeyword(value || ''); setPage(1); }
  }));

  const review = async (skill, action, reviewReason = '') => {
    if (skill.mock) {
      setItems(current => current.map(item => item.id === skill.id ? { ...item, review_status: action === 'approve' ? 'approved' : 'rejected', review_reason: reviewReason } : item));
      setTotal(current => Math.max(0, status === 'pending' ? current - 1 : current));
      showSuccess(action === 'approve' ? '审核通过，技能已发布' : '已驳回该技能');
      setRejecting(null);
      setReason('');
      return;
    }
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
