import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API } from '../../helpers';
import './index.css';

const STATUS = { idle: '等待输入', running: '执行中', stopping: '正在停止', ended: '已结束', stopped: '已停止', failed: '测试失败', expired: '已超时' };
const active = status => ['idle', 'running', 'stopping'].includes(status);
const unwrap = response => {
  if (response.data?.success === false) throw new Error(response.data.message || '操作失败');
  return response.data?.data;
};
const errorText = error => error.response?.data?.message || error.message || '测试请求失败';
const dateText = time => new Date(time * 1000).toLocaleString('zh-CN');
const fileBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, contentBase64: String(reader.result).split(',')[1] });
  reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
  reader.readAsDataURL(file);
});
const rank = name => ({ docx: 0, pdf: 1, xlsx: 2, pptx: 3, html: 4 }[name.split('.').pop().toLowerCase()] ?? 5);

/** Review-only chat: polling is read-only; containers are created exclusively by an explicit click. */
export default function SkillTest() {
  const { id } = useParams();
  const [skill, setSkill] = useState(null);
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState(null);
  const [outputs, setOutputs] = useState([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outputError, setOutputError] = useState('');
  const endRef = useRef(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const session = detail?.session;
  const pending = skill?.review_status === 'pending' && skill?.visibility === 'public';
  const ownActive = history.some(item => item.reviewer_id === JSON.parse(localStorage.getItem('user') || '{}').id && active(item.status) && item.expires_at > Date.now() / 1000);

  const loadHistory = useCallback(async () => setHistory(unwrap(await API.get(`/api/personal-skill/admin/${id}/tests`)) || []), [id]);
  useEffect(() => {
    let live = true;
    Promise.all([API.get(`/api/personal-skill/admin/${id}`), API.get('/api/skill-test/admin/config'), API.get(`/api/personal-skill/admin/${id}/tests`)]).then(([s, c, h]) => {
      if (!live) return;
      setSkill(unwrap(s)); setConfig(unwrap(c)); setHistory(unwrap(h) || []);
    }).catch(e => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [id]);

  useEffect(() => {
    if (!selected) return undefined;
    let live = true;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      let continuePolling = true;
      try {
        const next = unwrap(await API.get(`/api/skill-test/admin/${selected}`, { signal: controller.signal }));
        if (!live) return;
        setDetail(next);
        continuePolling = active(next.session.status);
        if (next.session.status !== 'running' && next.session.status !== 'stopping') {
          try {
            const data = unwrap(await API.get(`/api/skill-test/admin/${selected}/files`, { signal: controller.signal }));
            if (!live) return;
            setOutputs((data?.files || []).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)));
            setOutputError('');
          } catch (e) { if (live) setOutputError(errorText(e)); }
          await loadHistory();
        }
      } catch (e) { if (live) setError(errorText(e)); }
      if (live && continuePolling) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [selected, loadHistory]);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, [detail?.events?.length]);
  useEffect(() => {
    const warn = event => { if (session && active(session.status) && detail.can_operate) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session, detail]);

  const choose = value => { setSelected(value); setDetail(null); setOutputs([]); setOutputError(''); setError(''); setDraft(''); setAttachments([]); };
  const create = async () => {
    setBusy(true); setError('');
    try {
      const item = unwrap(await API.post(`/api/personal-skill/admin/${id}/tests`, {}));
      choose(item.id); await loadHistory();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!draft.trim() || !session || session.status !== 'idle') return;
    const target = selected;
    setBusy(true); setError('');
    try {
      const files = await Promise.all(attachments.map(fileBase64));
      unwrap(await API.post(`/api/skill-test/admin/${target}/messages`, { message: draft, files }));
      if (selectedRef.current === target) {
        setDraft(''); setAttachments([]);
        setDetail(value => ({ ...value, session: { ...value.session, status: 'running', error: '' } }));
      }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const end = async stop => {
    setBusy(true); setError('');
    try {
      unwrap(await API.post(`/api/skill-test/admin/${selected}/${stop ? 'stop' : 'finish'}`, {}));
      const next = unwrap(await API.get(`/api/skill-test/admin/${selected}`)); setDetail(next); await loadHistory();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const attach = event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const next = [...attachments, ...files];
    if (next.length > 10 || next.some(f => f.size > 20 * 1024 * 1024) || next.reduce((sum, f) => sum + f.size, 0) > 80 * 1024 * 1024) { setError('一次最多10个文件，单个20 MB、合计80 MB以内'); return; }
    if (new Set(next.map(f => f.name)).size !== next.length) { setError('附件名称重复，请移除或重命名'); return; }
    setAttachments(next);
  };
  const download = async name => {
    try {
      const response = await API.get(`/api/skill-test/admin/${selected}/download`, { params: { name }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError('产物下载失败，请检查文件是否仍在保留期内'); }
  };
  const canSend = detail?.can_operate && session?.status === 'idle' && !detail?.outdated && !busy;

  return <main className='skill-test-page'>
    <header className='skill-test-heading'><div><Link to='/skill/reviews'>← 返回待审核列表</Link><h1>技能测试</h1><p>在隔离环境中验证上传版本，不影响已发布技能和正式使用统计。</p></div>
      <button className='skill-test-primary' type='button' disabled={!pending || !config?.enabled || busy || ownActive} onClick={create}>{busy && !selected ? '正在创建…' : '新建测试'}</button>
    </header>
    {error && <div className='skill-test-alert' role='alert'>{error}</div>}
    {!config?.enabled && config && <div className='skill-test-alert'>{config.message}</div>}
    <div className='skill-test-layout'>
      <aside className='skill-test-panel skill-test-sidebar'>
        <h2>{skill?.display_name || skill?.name || '加载技能…'}</h2>
        <dl><dt>上传人</dt><dd>{skill?.owner || '—'}</dd><dt>提交版本</dt><dd>{skill?.version || '—'}</dd><dt>默认模型</dt><dd>{config?.model || '未设置'}</dd></dl>
        <p>{skill?.description || '暂无用途说明'}</p>
        <div className='skill-test-policy'>测试容器不联网，支持环境内已有的命令和依赖。仅保存 output 中的正式产物，保留{config?.retention_days || 7}天；过程文件随会话结束删除。</div>
        <h3>测试记录 <span>{history.length}</span></h3>
        {!history.length && <p className='skill-test-muted'>尚无测试记录，点击“新建测试”开始。</p>}
        <nav aria-label='测试历史'>{history.map(item => <button type='button' key={item.id} disabled={busy} className={selected === item.id ? 'selected' : ''} onClick={() => choose(item.id)}>
          <strong>v{item.version} · {STATUS[item.status] || item.status}</strong><span>{dateText(item.created_at)}</span><small>{item.reviewer}</small>
        </button>)}</nav>
      </aside>
      <section className='skill-test-panel skill-test-chat' aria-label='测试问答'>
        <div className='skill-test-toolbar'><div><strong>{session ? STATUS[session.status] || session.status : '开始验证技能'}</strong><span>{session ? `快照 v${session.version} · ${session.model}` : '多轮问答 · 文件输入 · 实际执行'}</span></div>
          {session && detail?.can_operate && !['ended', 'stopped'].includes(session.status) && <button type='button' disabled={busy} onClick={() => end(session.status === 'running')}>{session.status === 'running' ? '停止执行' : '结束测试'}</button>}
        </div>
        {detail?.outdated && <div className='skill-test-alert'>该记录对应旧版本或技能已审核，只可查看，请重新选择待审核版本测试。</div>}
        {session?.error && <div className='skill-test-alert' role='alert'>{session.error}</div>}
        <div className='skill-test-conversation' aria-live='polite'>
          {!selected && <div className='skill-test-empty'><h2>用真实问题检验技能</h2><p>新建测试后，描述要验证的任务，并按需上传文档、图片或表格。</p></div>}
          {selected && !detail && <p>正在读取测试记录…</p>}
          {detail?.events?.map((event, index) => ['user', 'assistant'].includes(event.kind) ? (event.text && <article key={index} className={`skill-test-message ${event.kind}`}><small>{event.kind === 'user' ? '审核人' : '测试助手'}</small><p>{event.text}</p></article>) : <details key={index} className='skill-test-process' open={event.text.startsWith('ask_user')}><summary>{event.kind === 'tool_start' ? '工具执行' : event.text.startsWith('ask_user') ? '需要您补充信息' : '执行结果'} · {event.text.split(' · ')[0]}</summary><pre>{event.text}</pre></details>)}
          {session?.status === 'running' && <p className='skill-test-muted' role='status'>正在执行，请稍候。可以停止本次测试。</p>}
          <div ref={endRef} />
        </div>
        {(outputs.length > 0 || outputError) && <section className='skill-test-outputs'><h3>正式产物</h3>{outputError && <p role='alert'>{outputError}</p>}{outputs.map(file => <button type='button' key={file.name} onClick={() => download(file.name)}>{file.name}<small>{(file.size / 1024).toFixed(1)} KB ↓</small></button>)}</section>}
        <div className='skill-test-composer'>
          <div className='skill-test-attachments'>{attachments.map((file, index) => <button type='button' key={file.name} disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => setAttachments(value => value.filter((_, i) => i !== index))}>{file.name} ×</button>)}</div>
          <textarea aria-label='测试问题' value={draft} disabled={!canSend} maxLength={16000} onChange={event => setDraft(event.target.value)} placeholder={selected ? '描述任务，或回复测试助手的问题…' : '请先新建测试或选择记录'} rows={3} />
          <div className='skill-test-compose-actions'><label className={!canSend ? 'disabled' : ''}>＋ 上传文件<input type='file' multiple disabled={!canSend} onChange={attach} /></label><small>单个文件 ≤ 20 MB</small><button className='skill-test-primary' type='button' disabled={!canSend || !draft.trim()} onClick={send}>发送</button></div>
        </div>
      </section>
    </div>
  </main>;
}
