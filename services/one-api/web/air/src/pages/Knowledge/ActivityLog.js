import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { API } from '../../helpers';

const ACTIONS = { create: '创建知识库', delete_base: '删除知识库', delete_document: '删除文件', delete_category: '删除分类', publish_public: '转公共', publish_subscription: '转订阅', subscribe: '订阅审核', transfer: '文件转入' };
const STATUSES = { success: '成功', approved: '已通过', rejected: '已驳回' };

/** Administrator activity history with server-side search and pagination. */
export default function ActivityLog({ onClose }) {
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState({ items: [], total: 0, names: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ page: String(page) });
    if (keyword) query.set('keyword', keyword);
    API.get(`/api/knowledge-admin/activities?${query}`, { timeout: 15000 }).then(response => {
      if (!response.data.success) throw new Error(response.data.message || '读取日志失败');
      if (active) setData(response.data.data);
    }).catch(cause => {
      if (active) setError(cause.response?.data?.message || (cause.response?.status === 404
        ? '知识库接口不存在，请更新并重启 OneAPI 服务' : cause.message || '读取日志失败'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [keyword, page, refresh]);
  const name = id => data.names?.[id] || (id ? `用户 #${id}` : '—');
  return <section className='knowledge-inbox knowledge-activity' aria-label='知识库日志'>
    <header className='knowledge-inbox-hero'>
      <button type='button' className='knowledge-back' onClick={onClose}><ArrowLeft size={16} />返回知识库</button>
      <div className='knowledge-activity-toolbar'>
      <div className='knowledge-inbox-heading'><h2>知识库日志</h2></div>
      <div className='knowledge-activity-actions'>
      <form className='knowledge-activity-search' role='search' onSubmit={event => {
        event.preventDefault(); setKeyword(search.trim()); setPage(1); setRefresh(value => value + 1);
      }}>
        <Search size={15} aria-hidden='true' />
        <input type='search' aria-label='搜索知识库日志' placeholder='搜索知识库、文件或人员' maxLength={128}
          value={search} onChange={event => setSearch(event.target.value)} />
        <button type='submit'>搜索</button>
      </form>
      <button type='button' className='knowledge-inbox-refresh' disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />刷新</button>
      </div></div>
    </header>
    <div className='knowledge-inbox-panel'>
      {error && <p role='alert'>{error}</p>}
      <div className='knowledge-table-wrap'>
        <table className='knowledge-table'>
          <thead><tr><th>知识库</th><th>操作与人员</th><th>相关人员</th><th>来源知识库</th><th>文件</th><th>结果</th><th>操作时间</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={7}>正在加载日志</td></tr> : error ? null : data.items.length === 0 ? <tr><td colSpan={7}>{keyword ? '未找到匹配的日志' : '暂无日志记录'}</td></tr> : data.items.map(item => <tr key={item.id}>
            <td>{item.knowledge_base_name}</td>
            <td><div className='knowledge-activity-operation'><strong>{ACTIONS[item.action] || item.action}</strong>
              <span><em>{['publish_public', 'publish_subscription', 'subscribe'].includes(item.action) ? '审核人' : '操作人'}</em>{name(item.actor_id)}</span></div></td>
            <td><div className='knowledge-activity-people'><span><em>创建人</em>{name(item.creator_id)}</span>
              {item.applicant_id > 0 && <span><em>申请人</em>{name(item.applicant_id)}</span>}</div></td>
            <td>{item.source_name || '—'}</td><td>{item.document_name || '—'}</td><td>{STATUSES[item.status] || item.status}</td><td>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className='zjugis-table-pagination knowledge-files-pagination'><span>共 {data.total} 条，每页 20 条</span><div>
        <button type='button' disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
        <span>{page} / {Math.max(1, Math.ceil(data.total / 20))}</span>
        <button type='button' disabled={loading || page * 20 >= data.total} onClick={() => setPage(value => value + 1)}>下一页</button>
      </div></div>
    </div>
  </section>;
}
