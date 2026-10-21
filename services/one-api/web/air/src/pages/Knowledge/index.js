import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calendar, Download, Eye, FileText, Layers, Plus, Search, Tag, Trash2, Upload } from 'lucide-react';
import { API } from '../../helpers';
import './index.css';

const SCOPES = [
  ['common', '共性知识库'],
  ['shared', '共享知识库'],
  ['personal', '个人知识库'],
];

const FILE_PAGE_SIZE = 20;

function unwrap(response) {
  if (!response?.data?.success) throw new Error(response?.data?.message || '请求失败');
  return response.data.data;
}

function unwrapDocumentPage(response) {
  const data = unwrap(response);
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, page_size: data.length || FILE_PAGE_SIZE };
  }
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total) || 0,
    page: Number(data?.page) || 1,
    page_size: Number(data?.page_size) || FILE_PAGE_SIZE,
  };
}

function documentsQuery({ page = 1, pageSize = FILE_PAGE_SIZE, keywords = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const text = String(keywords || '').trim();
  if (text) params.set('keywords', text);
  return params.toString();
}

async function errorMessage(error) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.message === 'string' && parsed.message) return parsed.message;
    } catch {
      // 下载失败时响应体可能不是 JSON，退回通用错误文案。
    }
  }
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (error?.response?.status === 404) return '知识库接口不存在，请更新并重启 OneAPI 服务';
  return error?.message || '请求失败';
}

function splitTags(value) {
  return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatUnix(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  return formatDate(number > 1e12 ? number : number * 1000);
}

function formatSize(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number < 0) return '—';
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)}M`;
  if (number >= 1024) return `${Math.ceil(number / 1024)}K`;
  return `${number}B`;
}

function fileExtension(name) {
  const parts = String(name || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function fileKind(name) {
  const extension = fileExtension(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  return 'file';
}

function isPlainTextName(name) {
  return ['md', 'txt', 'json', 'csv', 'log', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'yaml', 'yml'].includes(fileExtension(name));
}

function mimeFor(name, contentType) {
  if (contentType && !contentType.includes('octet-stream')) return contentType;
  const extension = fileExtension(name);
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'md' || extension === 'txt' || extension === 'log') return 'text/plain; charset=utf-8';
  if (extension === 'json') return 'application/json';
  if (extension === 'html' || extension === 'htm') return 'text/html; charset=utf-8';
  return contentType || 'application/octet-stream';
}

function revokeViewerUrl(viewer) {
  if (viewer?.objectUrl) URL.revokeObjectURL(viewer.objectUrl);
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

const KnowledgeLibrary = () => {
  const [libraries, setLibraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('common');
  const [keyword, setKeyword] = useState('');
  const [order, setOrder] = useState('desc');
  const [counts, setCounts] = useState({});
  const [opened, setOpened] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [fileKeyword, setFileKeyword] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', kind: 'common', tags: '' });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [summaryFile, setSummaryFile] = useState(null);
  const [summaryText, setSummaryText] = useState('');
  const [viewer, setViewer] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [busy, setBusy] = useState('');
  const fileInput = useRef(null);
  const counted = useRef(new Set());
  const viewerRef = useRef(null);
  viewerRef.current = viewer;

  useEffect(() => () => { revokeViewerUrl(viewerRef.current); }, []);

  const closeViewer = () => {
    setViewer(current => {
      revokeViewerUrl(current);
      return null;
    });
  };

  const loadLibraries = async () => {
    const rows = unwrap(await API.get('/api/knowledge-admin/bases'));
    setLibraries(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadLibraries()
      .catch(async cause => {
        const message = await errorMessage(cause);
        if (!cancelled) setError(message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pending = libraries.filter(item => !counted.current.has(item.id));
    pending.forEach(item => counted.current.add(item.id));
    void mapPool(pending, 3, async item => {
      try {
        const page = unwrapDocumentPage(await API.get(`/api/knowledge-admin/bases/${item.id}/documents?${documentsQuery({ page: 1, pageSize: 1 })}`));
        if (!cancelled) setCounts(current => ({ ...current, [item.id]: page.total }));
      } catch {
        // 单个知识库的文件数量失败时保留目录，卡片显示占位。
        if (!cancelled) setCounts(current => ({ ...current, [item.id]: null }));
      }
    });
    return () => { cancelled = true; };
  }, [libraries]);

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return libraries
      .filter(item => item.kind === scope)
      .filter(item => {
        if (!text) return true;
        return [item.name, item.description, item.tags, item.owner_username].some(value => String(value || '').toLowerCase().includes(text));
      })
      .sort((left, right) => {
        const delta = new Date(left.updated_at || left.created_at).getTime() - new Date(right.updated_at || right.created_at).getTime();
        return order === 'asc' ? delta : -delta;
      });
  }, [libraries, scope, keyword, order]);

  const countsByScope = useMemo(() => Object.fromEntries(SCOPES.map(([key]) => [key, libraries.filter(item => item.kind === key).length])), [libraries]);

  const filePageCount = Math.max(1, Math.ceil(documentTotal / FILE_PAGE_SIZE) || 1);

  const loadDocuments = async (library, { page = 1, keywords = '' } = {}) => {
    if (!library) return;
    setDocumentsLoading(true);
    setError('');
    try {
      const result = unwrapDocumentPage(await API.get(
        `/api/knowledge-admin/bases/${library.id}/documents?${documentsQuery({ page, keywords })}`,
      ));
      let nextPage = result.page || page;
      const totalPages = Math.max(1, Math.ceil(result.total / FILE_PAGE_SIZE) || 1);
      if (result.total > 0 && nextPage > totalPages) {
        const fallback = unwrapDocumentPage(await API.get(
          `/api/knowledge-admin/bases/${library.id}/documents?${documentsQuery({ page: totalPages, keywords })}`,
        ));
        setDocuments(fallback.items);
        setDocumentTotal(fallback.total);
        setFilePage(fallback.page || totalPages);
        setCounts(current => ({ ...current, [library.id]: keywords.trim() ? current[library.id] : fallback.total }));
        return;
      }
      setDocuments(result.items);
      setDocumentTotal(result.total);
      setFilePage(nextPage);
      if (!keywords.trim()) setCounts(current => ({ ...current, [library.id]: result.total }));
    } catch (cause) {
      setDocuments([]);
      setDocumentTotal(0);
      setError(await errorMessage(cause));
    } finally {
      setDocumentsLoading(false);
    }
  };

  const openFiles = async library => {
    setOpened(library);
    setFileKeyword('');
    setFileSearch('');
    setFilePage(1);
    await loadDocuments(library, { page: 1, keywords: '' });
  };

  const refreshOpened = async library => {
    if (!library) return;
    await loadDocuments(library, { page: filePage, keywords: fileSearch });
  };

  const removeLibrary = async library => {
    setError('');
    try {
      unwrap(await API.delete(`/api/knowledge-admin/bases/${library.id}`));
      setConfirming(null);
      if (opened?.id === library.id) setOpened(null);
      await loadLibraries();
    } catch (cause) {
      setError(await errorMessage(cause));
    }
  };

  const createLibrary = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      unwrap(await API.post('/api/knowledge-admin/bases', {
        name: form.name.trim(),
        description: form.description.trim(),
        kind: form.kind,
        tags: form.tags.trim(),
      }));
      setCreating(false);
      setForm({ name: '', description: '', kind: scope, tags: '' });
      setScope(form.kind);
      await loadLibraries();
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !opened) return;
    setBusy('upload');
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      unwrap(await API.post(`/api/knowledge-admin/bases/${opened.id}/documents`, body));
      await refreshOpened(opened);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const openBrowse = async file => {
    if (!opened) return;
    const documentId = file.id;
    const base = `/api/knowledge-admin/bases/${opened.id}/documents/${documentId}`;
    setBusy(`${documentId}:browse`);
    setError('');
    setViewer(current => {
      revokeViewerUrl(current);
      return { id: documentId, name: file.name, loading: true, mode: 'text', content: '' };
    });
    try {
      const kind = fileKind(file.name);
      if (kind === 'image' || kind === 'pdf' || isPlainTextName(file.name)) {
        const response = await API.get(`${base}/file`, { responseType: 'blob' });
        const blob = response.data;
        const contentType = mimeFor(file.name, response.headers?.['content-type'] || blob.type || '');
        if (kind === 'image' || contentType.startsWith('image/')) {
          const objectUrl = URL.createObjectURL(new Blob([blob], { type: contentType }));
          setViewer(current => {
            if (!current || current.id !== documentId) {
              URL.revokeObjectURL(objectUrl);
              return current;
            }
            revokeViewerUrl(current);
            return { id: documentId, name: file.name, loading: false, mode: 'image', objectUrl };
          });
          return;
        }
        if (kind === 'pdf' || contentType.includes('pdf')) {
          const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
          setViewer(current => {
            if (!current || current.id !== documentId) {
              URL.revokeObjectURL(objectUrl);
              return current;
            }
            revokeViewerUrl(current);
            return { id: documentId, name: file.name, loading: false, mode: 'pdf', objectUrl };
          });
          return;
        }
        const content = await blob.text();
        setViewer(current => {
          if (!current || current.id !== documentId) return current;
          revokeViewerUrl(current);
          return { id: documentId, name: file.name, loading: false, mode: 'text', content };
        });
        return;
      }
      const rows = unwrap(await API.get(`${base}/chunks`));
      const content = (Array.isArray(rows) ? rows : [])
        .map(item => String(item?.content || '').trim())
        .filter(Boolean)
        .join('\n\n');
      setViewer(current => {
        if (!current || current.id !== documentId) return current;
        revokeViewerUrl(current);
        return { id: documentId, name: file.name, loading: false, mode: 'text', content };
      });
    } catch (cause) {
      setViewer(current => {
        if (!current || current.id !== documentId) return current;
        revokeViewerUrl(current);
        return null;
      });
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const openChunks = async file => {
    if (!opened) return;
    setBusy(`${file.id}:chunks`);
    setError('');
    try {
      const rows = unwrap(await API.get(`/api/knowledge-admin/bases/${opened.id}/documents/${file.id}/chunks`));
      setChunks({ name: file.name, items: Array.isArray(rows) ? rows : [] });
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const runFileAction = async (file, action) => {
    if (!opened) return;
    if (action === 'browse') {
      await openBrowse(file);
      return;
    }
    if (action === 'chunks') {
      await openChunks(file);
      return;
    }
    setBusy(`${file.id}:${action}`);
    setError('');
    try {
      const base = `/api/knowledge-admin/bases/${opened.id}/documents/${file.id}`;
      if (action === 'download') {
        const response = await API.get(`${base}/file`, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = file.name || 'download';
        link.click();
        URL.revokeObjectURL(url);
      } else if (action === 'parse') {
        unwrap(await API.post(`${base}/parse`));
        await refreshOpened(opened);
      } else if (action === 'delete') {
        unwrap(await API.delete(base));
        setConfirming(null);
        await refreshOpened(opened);
      }
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const saveSummary = async event => {
    event.preventDefault();
    if (!opened || !summaryFile) return;
    setSaving(true);
    setError('');
    try {
      unwrap(await API.put(`/api/knowledge-admin/bases/${opened.id}/documents/${summaryFile.id}/summary`, { summary: summaryText.trim() }));
      setSummaryFile(null);
      await refreshOpened(opened);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const fileCount = id => {
    if (!(id in counts)) return '…';
    return counts[id] == null ? '—' : `${counts[id]}个文件`;
  };

  return <div className='knowledge-admin'>
    <h1 className='knowledge-admin-title'>知识库</h1>
    {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
    {opened ? <section className='knowledge-files'>
      <header>
        <button type='button' className='knowledge-back' onClick={() => { closeViewer(); setChunks(null); setOpened(null); }}><ArrowLeft size={16} />返回</button>
        <h2>{opened.name} - 文件清单</h2>
        <button type='button' className='knowledge-primary' disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>
          <Upload size={15} />{busy === 'upload' ? '正在上传' : '上传文件'}
        </button>
        <input ref={fileInput} type='file' hidden onChange={uploadFile} />
      </header>
      <div className='knowledge-files-toolbar'>
        <label className='knowledge-search'>
          <Search size={16} />
          <input
            value={fileKeyword}
            onChange={event => setFileKeyword(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              const next = fileKeyword.trim();
              setFileSearch(next);
              setFilePage(1);
              void loadDocuments(opened, { page: 1, keywords: next });
            }}
            placeholder='搜索文件名称...'
          />
        </label>
        <button
          type='button'
          className='knowledge-back'
          disabled={documentsLoading}
          onClick={() => {
            const next = fileKeyword.trim();
            setFileSearch(next);
            setFilePage(1);
            void loadDocuments(opened, { page: 1, keywords: next });
          }}
        >搜索</button>
      </div>
      <div className='knowledge-table-wrap'>
        <table>
          <thead><tr><th>文件名称</th><th>大小</th><th>上传时间</th><th>切片数量</th><th>摘要</th><th>操作</th></tr></thead>
          <tbody>
            {documentsLoading ? <tr><td colSpan={6}>正在加载文件</td></tr> : documents.length === 0 ? <tr><td colSpan={6}>{fileSearch ? '没有匹配的文件' : '暂无文件'}</td></tr> : documents.map(file => <tr key={file.id}>
              <td>{file.name}</td>
              <td>{formatSize(file.size)}</td>
              <td>{formatUnix(file.create_time || file.update_time)}</td>
              <td>{Number.isFinite(Number(file.chunk_count)) ? file.chunk_count : '—'}</td>
              <td className='knowledge-summary' title={file.summary || ''}>{file.summary || '—'}</td>
              <td className='knowledge-ops'>
                <button type='button' disabled={busy === `${file.id}:browse`} onClick={() => runFileAction(file, 'browse')}><Eye size={14} />浏览</button>
                <button type='button' disabled={busy === `${file.id}:download`} onClick={() => runFileAction(file, 'download')}><Download size={14} />下载</button>
                <button type='button' disabled={busy === `${file.id}:chunks`} onClick={() => runFileAction(file, 'chunks')}><Layers size={14} />切片</button>
                <button type='button' onClick={() => { setSummaryFile(file); setSummaryText(file.summary || ''); }}><FileText size={14} />摘要</button>
                <button type='button' className='danger' onClick={() => setConfirming({ type: 'file', file })}><Trash2 size={14} />删除</button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className='zjugis-table-pagination knowledge-files-pagination'>
        <span>共 {documentTotal} 条，每页 {FILE_PAGE_SIZE} 条</span>
        <div>
          <button type='button' aria-label='上一页' disabled={documentsLoading || filePage <= 1} onClick={() => {
            const next = filePage - 1;
            setFilePage(next);
            void loadDocuments(opened, { page: next, keywords: fileSearch });
          }}>上一页</button>
          <span>{filePage} / {filePageCount}</span>
          <button type='button' aria-label='下一页' disabled={documentsLoading || filePage >= filePageCount} onClick={() => {
            const next = filePage + 1;
            setFilePage(next);
            void loadDocuments(opened, { page: next, keywords: fileSearch });
          }}>下一页</button>
        </div>
      </div>
    </section> : <>
      <div className='knowledge-tabs' role='tablist' aria-label='知识库分类'>
        {SCOPES.map(([key, label]) => <button key={key} type='button' role='tab' aria-selected={scope === key} className={scope === key ? 'active' : ''} onClick={() => setScope(key)}>
          {label}<span>{countsByScope[key] || 0}</span>
        </button>)}
      </div>
      <div className='knowledge-toolbar'>
        <label className='knowledge-search'><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder='搜索知识库...' /></label>
        <select aria-label='排序' value={order} onChange={event => setOrder(event.target.value)}>
          <option value='desc'>按时间降序</option>
          <option value='asc'>按时间升序</option>
        </select>
        <button type='button' className='knowledge-primary' onClick={() => { setForm({ name: '', description: '', kind: scope, tags: '' }); setCreating(true); }}><Plus size={16} />新建知识库</button>
      </div>
      {loading ? <p className='knowledge-empty' role='status'>正在加载知识库</p> : visible.length === 0 ? <p className='knowledge-empty'>
        {libraries.some(item => item.kind !== scope) ? '当前分类暂无知识库。用户创建的内容在「个人知识库」或「共享知识库」中。' : '暂无知识库'}
      </p> : <div className='knowledge-grid'>
        {visible.map(library => <article key={library.id} className='knowledge-card'>
          <header><h2>{library.name}</h2></header>
          <p>{library.description || '暂无描述'}</p>
          <div className='knowledge-tags'>{splitTags(library.tags).map(tag => <span key={tag}><Tag size={12} />{tag}</span>)}</div>
          <div className='knowledge-meta'>
            {(library.kind === 'personal' || library.kind === 'shared') && <span>所有者 {library.owner_username || ('#' + library.owner_user_id)}</span>}
            <span><FileText size={13} />{fileCount(library.id)}</span>
            <span><Calendar size={13} />{formatDate(library.updated_at || library.created_at)}</span>
          </div>
          <div className='knowledge-card-actions'>
            <button type='button' onClick={() => openFiles(library)}>查看文件清单</button>
            <button type='button' className='remove' onClick={() => setConfirming({ type: 'library', library })}>删除</button>
          </div>
        </article>)}
      </div>}
    </>}
    {creating && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={createLibrary}>
      <header><h2>新建知识库</h2><button type='button' onClick={() => setCreating(false)}>×</button></header>
      <label>名称<input autoFocus required maxLength={128} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入知识库名称' /></label>
      <label>描述<textarea maxLength={500} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder='填写知识库覆盖的内容和用途' /></label>
      <label>类型<select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value }))}>
        {SCOPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {form.kind === 'shared' && <p className='knowledge-hint'>共享知识库默认仅创建者可见，部门或用户授权仍由管理接口写入。</p>}
      <label>标签<input maxLength={200} value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} placeholder='多个标签用逗号分隔' /></label>
      <footer><button type='button' onClick={() => setCreating(false)}>取消</button><button type='submit' className='knowledge-primary' disabled={saving || form.name.trim() === ''}>{saving ? '正在创建' : '确定'}</button></footer>
    </form></div>}
    {summaryFile && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={saveSummary}>
      <header><h2>编辑摘要</h2><button type='button' onClick={() => setSummaryFile(null)}>×</button></header>
      <p className='knowledge-hint'>{summaryFile.name}</p>
      <label>摘要<textarea maxLength={500} value={summaryText} onChange={event => setSummaryText(event.target.value)} placeholder='填写文件摘要' /></label>
      <footer><button type='button' onClick={() => setSummaryFile(null)}>取消</button><button type='submit' className='knowledge-primary' disabled={saving}>{saving ? '正在保存' : '保存'}</button></footer>
    </form></div>}
    {viewer && <div className='knowledge-viewer-shell' role='presentation'>
      <section className='knowledge-viewer' role='dialog' aria-modal='true' aria-label='浏览文件'>
        <header>
          <h2>{viewer.name}</h2>
          <div className='knowledge-viewer-actions'>
            <button type='button' disabled={viewer.loading || !opened} onClick={() => runFileAction({ id: viewer.id, name: viewer.name }, 'download')}><Download size={16} />下载</button>
            <button type='button' className='close' onClick={closeViewer}>×</button>
          </div>
        </header>
        <div className={`knowledge-viewer-body ${viewer.mode}`}>
          {viewer.loading ? <p role='status'>正在加载…</p>
            : viewer.mode === 'image' && viewer.objectUrl
              ? <img src={viewer.objectUrl} alt={viewer.name} />
              : viewer.mode === 'pdf' && viewer.objectUrl
                ? <iframe title={viewer.name} src={viewer.objectUrl} />
                : (viewer.content || '') === ''
                  ? <p className='knowledge-hint'>暂无解析内容</p>
                  : <article><pre>{viewer.content}</pre></article>}
        </div>
      </section>
    </div>}
    {chunks && <div className='knowledge-modal-backdrop'><section className='knowledge-modal knowledge-chunks-modal' role='dialog' aria-label='切片列表'>
      <header><h2>{chunks.name} - 切片列表</h2><button type='button' onClick={() => setChunks(null)}>×</button></header>
      {chunks.items.length === 0
        ? <p className='knowledge-hint'>这个文件还没有切片。</p>
        : <ol className='knowledge-chunks'>{chunks.items.map(item => <li key={item.id || item.content}>{item.content}</li>)}</ol>}
    </section></div>}
    {confirming && <div className='knowledge-modal-backdrop'><section className='knowledge-modal' role='dialog' aria-label='确认删除'>
      <header><h2>确认删除</h2><button type='button' onClick={() => setConfirming(null)}>×</button></header>
      <p>{confirming.type === 'library' ? `删除后将移除「${confirming.library.name}」及其文件，桌面端不再可用。` : `删除文件「${confirming.file.name}」？`}</p>
      <footer>
        <button type='button' onClick={() => setConfirming(null)}>取消</button>
        <button type='button' className='remove' onClick={() => confirming.type === 'library' ? removeLibrary(confirming.library) : runFileAction(confirming.file, 'delete')}>删除</button>
      </footer>
    </section></div>}
  </div>;
};

export default KnowledgeLibrary;
