import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ClipboardList, Download, Eye, FileText, Folder, FolderPlus, Layers, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Tag, Trash2, Upload, Users } from 'lucide-react';
import { API } from '../../helpers';
import CustomSelect from '../../components/CustomSelect';
import './index.css';

/** Category dialog: type is the library kind; 授权访问 independently sets require_auth. */
const CATEGORY_VISIBILITY = [
  ['personal', '个人'],
  ['public', '公开'],
  ['authorized', '授权'],
];

const EMPTY_CATEGORY_FORM = { id: 0, name: '', visibility: 'personal', requireAuth: false };

function categoryPayload(visibility, name, requireAuth) {
  const type = visibility === 'public' ? 'common' : visibility === 'authorized' ? 'shared' : 'personal';
  return { name, type, require_auth: Boolean(requireAuth) };
}

function categoryFormFromRow(category) {
  const visibility = category.type === 'common' ? 'public' : category.type === 'shared' ? 'authorized' : 'personal';
  return {
    id: Number(category.id) || 0,
    name: category.name || '',
    visibility,
    requireAuth: Boolean(category.require_auth),
  };
}

const FILE_PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 20;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const PARSE_POLL_MS = 2500;

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

const STATS_PAGE_SIZE = 100;
const STATS_MAX_PAGES = 50;

/** Loads document total and summed byte size for one library card. */
async function loadLibraryDocumentStats(libraryId) {
  let page = 1;
  let total = 0;
  let bytes = 0;
  let seen = 0;
  for (; page <= STATS_MAX_PAGES; page += 1) {
    const result = unwrapDocumentPage(await API.get(
      `/api/knowledge-admin/bases/${libraryId}/documents?${documentsQuery({ page, pageSize: STATS_PAGE_SIZE })}`,
    ));
    total = result.total;
    for (const file of result.items) bytes += Number(file.size) || 0;
    seen += result.items.length;
    if (result.items.length === 0 || seen >= total) break;
  }
  return { total, bytes, complete: seen >= total || total === 0 };
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

function formatSizeLabel(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number) || number < 0) return '—';
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)}MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(1)}KB`;
  return `${number}B`;
}

const AVATAR_COLORS = ['#2f6fe0', '#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be123c'];

function avatarColor(name) {
  const text = String(name || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash + text.charCodeAt(index)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

function personInitial(name) {
  const text = String(name || '').trim();
  return text ? text.slice(0, 1) : '人';
}

function isPersonalLibrary(library) {
  return library?.kind === 'personal' && !Number(library.category_id || 0);
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

function isSkippedUploadName(name) {
  const base = String(name || '').split(/[/\\]/).pop() || '';
  if (base === '' || base === '.' || base === '..') return true;
  const lower = base.toLowerCase();
  return lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini' || lower.startsWith('._');
}

// RAGFlow reports run as UNSTART/RUNNING/CANCEL/DONE/FAIL or the legacy codes 0–4.
function parseState(file) {
  const run = String(file?.run ?? '').trim().toUpperCase();
  const progress = Number(file?.progress);
  const percent = Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress <= 1 ? progress * 100 : progress)))
    : null;
  if (run === '3' || run === 'DONE') return { key: 'done', label: '已解析', pending: false, retry: false };
  if (run === '4' || run === 'FAIL') return { key: 'fail', label: '解析失败', pending: false, retry: true };
  if (run === '2' || run === 'CANCEL') return { key: 'cancel', label: '已取消', pending: false, retry: true };
  if (run === '1' || run === 'RUNNING') {
    return {
      key: 'running',
      label: percent == null || percent <= 0 ? '解析中' : `解析中 ${percent}%`,
      pending: true,
      retry: false,
    };
  }
  if (run === '0' || run === 'UNSTART') return { key: 'wait', label: '等待解析', pending: true, retry: true };
  if (Number(file?.chunk_count) > 0) return { key: 'done', label: '已解析', pending: false, retry: false };
  return { key: 'unknown', label: '—', pending: false, retry: false };
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
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('personal');
  const [keyword, setKeyword] = useState('');
  const [order, setOrder] = useState('desc');
  const [counts, setCounts] = useState({});
  const [sizes, setSizes] = useState({});
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', tags: '' });
  const [opened, setOpened] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [fileKeyword, setFileKeyword] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', kind: 'personal', tags: '', category_id: 0 });
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY_FORM);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [deptKey, setDeptKey] = useState('all');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [person, setPerson] = useState(null);
  const [personFiles, setPersonFiles] = useState([]);
  const [personFilesLoading, setPersonFilesLoading] = useState(false);
  const [personFileQuery, setPersonFileQuery] = useState('');
  const [personFilePage, setPersonFilePage] = useState(1);
  const [personLibrariesOpen, setPersonLibrariesOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [cardMenuId, setCardMenuId] = useState(null);
  const [tabMenu, setTabMenu] = useState(null);
  const [summaryFile, setSummaryFile] = useState(null);
  const [summaryText, setSummaryText] = useState('');
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState('');
  const fileInput = useRef(null);
  // Only mark a library settled after stats resolve. Marking before the request
  // breaks under React Strict Mode: the first effect is cancelled, ids stay
  // "counted", and the remount never fetches again — cards stuck on "…".
  const settledStats = useRef(new Set());
  const inflightStats = useRef(new Set());
  const viewerRef = useRef(null);
  const loadDocumentsRef = useRef(null);
  const pollRef = useRef({ library: null, page: 1, keywords: '' });
  const personLoadRef = useRef(0);
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

  const loadCategories = async () => {
    const rows = unwrap(await API.get('/api/knowledge-admin/categories'));
    setCategories(Array.isArray(rows) ? rows : []);
  };

  const loadUsers = async () => {
    const pageSize = 100;
    const rows = [];
    try {
      for (let page = 0; page < 30; page += 1) {
        const batch = unwrap(await API.get(`/api/user/?p=${page}&size=${pageSize}`));
        const list = Array.isArray(batch) ? batch : [];
        list.forEach(user => {
          const id = Number(user?.id);
          if (!Number.isFinite(id) || id <= 0 || Number(user.status) === 3) return;
          rows.push(user);
        });
        if (list.length < pageSize) break;
      }
      setUsers(rows);
    } catch (cause) {
      setUsers([]);
      setError(await errorMessage(cause));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUsersLoading(true);
    Promise.all([loadLibraries(), loadCategories(), loadUsers(), loadReviewCount()])
      .catch(async cause => {
        const message = await errorMessage(cause);
        if (!cancelled) setError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setUsersLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pending = libraries.filter(item => (
      !settledStats.current.has(item.id) && !inflightStats.current.has(item.id)
    ));
    pending.forEach(item => inflightStats.current.add(item.id));
    void mapPool(pending, 3, async item => {
      try {
        const stats = await loadLibraryDocumentStats(item.id);
        if (cancelled) return;
        settledStats.current.add(item.id);
        setCounts(current => ({ ...current, [item.id]: stats.total }));
        setSizes(current => ({
          ...current,
          [item.id]: stats.complete ? stats.bytes : null,
        }));
      } catch {
        // 单个知识库的文件数量失败时保留目录，卡片显示占位。
        if (cancelled) return;
        settledStats.current.add(item.id);
        setCounts(current => ({ ...current, [item.id]: null }));
        setSizes(current => ({ ...current, [item.id]: null }));
      } finally {
        inflightStats.current.delete(item.id);
      }
    });
    return () => {
      cancelled = true;
      pending.forEach(item => inflightStats.current.delete(item.id));
    };
  }, [libraries]);

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    const categoryId = scope.startsWith('c:') ? Number(scope.slice(2)) : 0;
    return libraries
      .filter(item => (categoryId
        ? Number(item.category_id || 0) === categoryId
        : item.kind === scope && !Number(item.category_id || 0)))
      .filter(item => {
        if (!text) return true;
        return [item.name, item.description, item.tags, item.owner_username].some(value => String(value || '').toLowerCase().includes(text));
      })
      .sort((left, right) => {
        const delta = new Date(left.updated_at || left.created_at).getTime() - new Date(right.updated_at || right.created_at).getTime();
        return order === 'asc' ? delta : -delta;
      });
  }, [libraries, scope, keyword, order]);

  const countsByScope = useMemo(() => {
    const counts = {
      personal: libraries.filter(item => item.kind === 'personal' && !Number(item.category_id || 0)).length,
    };
    categories.forEach(category => {
      counts[`c:${category.id}`] = libraries.filter(item => Number(item.category_id || 0) === category.id).length;
    });
    return counts;
  }, [libraries, categories]);
  const tabs = [
    { key: 'personal', label: '个人知识库', category: null },
    ...categories.map(category => ({ key: `c:${category.id}`, label: category.name, category })),
  ];
  const activeCategory = categories.find(category => `c:${category.id}` === scope);

  const people = useMemo(() => {
    const map = new Map();
    users.forEach(user => {
      const id = Number(user.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const name = String(user.display_name || user.username || '').trim() || `用户 ${id}`;
      map.set(id, {
        id,
        name,
        username: String(user.username || ''),
        department: String(user.department_name || '').trim(),
        createdAt: user.created_at || '',
        status: Number(user.status) || 1,
      });
    });
    libraries.filter(isPersonalLibrary).forEach(library => {
      const id = Number(library.owner_user_id);
      if (!Number.isFinite(id) || id <= 0 || map.has(id)) return;
      const name = String(library.owner_username || '').trim() || `用户 ${id}`;
      map.set(id, { id, name, username: name, department: '', createdAt: '', status: 1 });
    });
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh'));
  }, [users, libraries]);

  const departments = useMemo(() => {
    const grouped = new Map();
    people.forEach(item => {
      if (!item.department) return;
      grouped.set(item.department, (grouped.get(item.department) || 0) + 1);
    });
    return [...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh'));
  }, [people]);

  const visiblePeople = useMemo(() => {
    const text = peopleQuery.trim().toLowerCase();
    return people.filter(item => {
      if (deptKey !== 'all' && item.department !== deptKey) return false;
      if (!text) return true;
      return [item.name, item.username, item.department].some(value => String(value || '').toLowerCase().includes(text));
    });
  }, [people, deptKey, peopleQuery]);

  const personLibraries = person
    ? libraries.filter(library => isPersonalLibrary(library) && Number(library.owner_user_id) === person.id)
    : [];

  const shownPersonFiles = useMemo(() => {
    const text = personFileQuery.trim().toLowerCase();
    if (!text) return personFiles;
    return personFiles.filter(file => [file.name, file.library_name, file.summary]
      .some(value => String(value || '').toLowerCase().includes(text)));
  }, [personFiles, personFileQuery]);
  const personFilePageCount = Math.max(1, Math.ceil(shownPersonFiles.length / FILE_PAGE_SIZE) || 1);
  const personFileRows = shownPersonFiles.slice((personFilePage - 1) * FILE_PAGE_SIZE, personFilePage * FILE_PAGE_SIZE);

  const filePageCount = Math.max(1, Math.ceil(documentTotal / FILE_PAGE_SIZE) || 1);

  const loadDocuments = async (library, { page = 1, keywords = '', silent = false } = {}) => {
    if (!library) return;
    if (!silent) {
      setDocumentsLoading(true);
      setError('');
    }
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
      if (silent) return;
      setDocuments([]);
      setDocumentTotal(0);
      setError(await errorMessage(cause));
    } finally {
      if (!silent) setDocumentsLoading(false);
    }
  };
  loadDocumentsRef.current = loadDocuments;
  pollRef.current = { library: opened, page: filePage, keywords: fileSearch };

  const pendingParse = documents.some(file => parseState(file).pending);
  useEffect(() => {
    if (!opened || !pendingParse) return undefined;
    // Keep the current rows on screen while RAGFlow chunking is still running.
    const timer = window.setInterval(() => {
      const current = pollRef.current;
      if (!current.library) return;
      void loadDocumentsRef.current?.(current.library, {
        page: current.page,
        keywords: current.keywords,
        silent: true,
      });
    }, PARSE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [opened, pendingParse]);

  const listLibraryDocuments = async library => {
    const rows = [];
    let page = 1;
    let total = 0;
    do {
      const result = unwrapDocumentPage(await API.get(
        `/api/knowledge-admin/bases/${library.id}/documents?${documentsQuery({ page, pageSize: 100 })}`,
      ));
      total = result.total;
      rows.push(...result.items.map(file => ({
        ...file,
        library_id: library.id,
        library_name: library.name,
      })));
      page += 1;
      if (result.items.length === 0) break;
    } while (rows.length < total && page <= 20);
    return rows;
  };

  const loadPersonFiles = async user => {
    const token = personLoadRef.current + 1;
    personLoadRef.current = token;
    setPersonFilesLoading(true);
    setError('');
    try {
      const owned = libraries.filter(library => isPersonalLibrary(library) && Number(library.owner_user_id) === user.id);
      const groups = await Promise.all(owned.map(library => listLibraryDocuments(library)));
      if (personLoadRef.current !== token) return;
      const rows = groups.flat().sort((left, right) => Number(right.create_time || right.update_time || 0) - Number(left.create_time || left.update_time || 0));
      setPersonFiles(rows);
      setPersonFilePage(current => Math.min(current, Math.max(1, Math.ceil(rows.length / FILE_PAGE_SIZE) || 1)));
    } catch (cause) {
      if (personLoadRef.current !== token) return;
      setPersonFiles([]);
      setError(await errorMessage(cause));
    } finally {
      if (personLoadRef.current === token) setPersonFilesLoading(false);
    }
  };

  const openPerson = async user => {
    closeViewer();
    setOpened(null);
    setPerson(user);
    setPersonFiles([]);
    setPersonFileQuery('');
    setPersonFilePage(1);
    setPersonLibrariesOpen(false);
    setCardMenuId(null);
    await loadPersonFiles(user);
  };

  const openFiles = async library => {
    setPerson(null);
    setOpened(library);
    setDocuments([]);
    setDocumentTotal(0);
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
      setEditing(current => current?.id === library.id ? null : current);
      if (opened?.id === library.id) setOpened(null);
      setPersonFiles(current => current.filter(file => Number(file.library_id) !== Number(library.id)));
      await loadLibraries();
    } catch (cause) {
      setError(await errorMessage(cause));
    }
  };

  const openEdit = library => {
    setCreating(false);
    setCategoryOpen(false);
    setEditing(library);
    setEditForm({
      name: library.name || '',
      description: library.description || '',
      tags: library.tags || '',
    });
  };

  const saveLibrary = async event => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      unwrap(await API.put(`/api/knowledge-admin/bases/${editing.id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        tags: editForm.tags.trim(),
      }));
      setEditing(null);
      await loadLibraries();
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const createLibrary = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const kind = form.category_id ? form.kind : 'personal';
      const created = unwrap(await API.post('/api/knowledge-admin/bases', {
        name: form.name.trim(),
        description: form.description.trim(),
        kind,
        tags: form.tags.trim(),
        ...(form.category_id ? { category_id: form.category_id } : {}),
      }));
      const categoryId = form.category_id || created?.category_id || 0;
      const library = {
        ...created,
        name: created?.name || form.name.trim(),
        description: created?.description ?? form.description.trim(),
        kind: created?.kind || kind,
        tags: created?.tags ?? form.tags.trim(),
        category_id: categoryId,
      };
      setCreating(false);
      setForm({ name: '', description: '', kind: 'personal', tags: '', category_id: 0 });
      setScope(categoryId ? `c:${categoryId}` : 'personal');
      await loadLibraries();
      await openFiles(library);
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
    if (isSkippedUploadName(file.name)) {
      setError('不支持上传该文件');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('文件不能超过 20MB');
      return;
    }
    setBusy('upload');
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      unwrap(await API.post(`/api/knowledge-admin/bases/${opened.id}/documents`, body));
      setFileKeyword('');
      setFileSearch('');
      setFilePage(1);
      await loadDocuments(opened, { page: 1, keywords: '' });
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const openBrowse = async file => {
    const libraryId = Number(file?.library_id || opened?.id || 0);
    if (!libraryId) return;
    const documentId = file.id;
    const base = `/api/knowledge-admin/bases/${libraryId}/documents/${documentId}`;
    setBusy(`${documentId}:browse`);
    setError('');
    setViewer(current => {
      revokeViewerUrl(current);
      return { id: documentId, library_id: libraryId, name: file.name, loading: true, mode: 'text', content: '' };
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
            return { id: documentId, library_id: libraryId, name: file.name, loading: false, mode: 'image', objectUrl };
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
            return { id: documentId, library_id: libraryId, name: file.name, loading: false, mode: 'pdf', objectUrl };
          });
          return;
        }
        const content = await blob.text();
        setViewer(current => {
          if (!current || current.id !== documentId) return current;
          revokeViewerUrl(current);
          return { id: documentId, library_id: libraryId, name: file.name, loading: false, mode: 'text', content };
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
        return { id: documentId, library_id: libraryId, name: file.name, loading: false, mode: 'text', content };
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
    const libraryId = Number(file?.library_id || opened?.id || 0);
    if (!libraryId || !file?.id) return;
    setBusy(`${file.id}:chunks`);
    setError('');
    try {
      const data = unwrap(await API.get(`/api/knowledge-admin/bases/${libraryId}/documents/${file.id}/chunk-viewer`));
      const url = typeof data?.url === 'string' ? data.url.trim() : '';
      if (!url) throw new Error('切片页面地址无效');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const runFileAction = async (file, action) => {
    const libraryId = Number(file?.library_id || opened?.id || 0);
    if (!libraryId) return;
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
      const base = `/api/knowledge-admin/bases/${libraryId}/documents/${file.id}`;
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
        if (file?.library_id && person) await loadPersonFiles(person);
        else await refreshOpened(opened);
      }
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy('');
    }
  };

  const saveSummary = async event => {
    event.preventDefault();
    const libraryId = Number(summaryFile?.library_id || opened?.id || 0);
    if (!libraryId || !summaryFile) return;
    setSaving(true);
    setError('');
    try {
      unwrap(await API.put(`/api/knowledge-admin/bases/${libraryId}/documents/${summaryFile.id}/summary`, { summary: summaryText.trim() }));
      setSummaryFile(null);
      if (summaryFile.library_id && person) await loadPersonFiles(person);
      else await refreshOpened(opened);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const personUsage = userId => {
    const owned = libraries.filter(library => isPersonalLibrary(library) && Number(library.owner_user_id) === Number(userId));
    if (owned.length === 0) return { libraries: 0, size: '0B' };
    if (owned.some(library => !(library.id in sizes))) return { libraries: owned.length, size: '…' };
    if (owned.some(library => sizes[library.id] == null)) return { libraries: owned.length, size: '—' };
    const bytes = owned.reduce((sum, library) => sum + (Number(sizes[library.id]) || 0), 0);
    return { libraries: owned.length, size: formatSizeLabel(bytes) };
  };

  const selectDepartment = key => {
    closeViewer();
    setPerson(null);
    setDeptKey(key);
    setPeopleQuery('');
  };

  const fileCount = id => {
    if (!(id in counts)) return '…';
    return counts[id] == null ? '—' : `${counts[id]}个`;
  };

  const librarySize = id => {
    if (!(id in sizes)) return '…';
    return sizes[id] == null ? '—' : formatSizeLabel(sizes[id]);
  };

  const libraryCreator = library => library.owner_username || (library.owner_user_id ? `#${library.owner_user_id}` : '—');

  const visitCount = library => {
    const value = library.visit_count ?? library.user_visit_count;
    return Number.isFinite(Number(value)) ? String(Number(value)) : '—';
  };

  const dailyUsage = library => {
    const value = library.daily_usage ?? library.daily_use_count;
    return Number.isFinite(Number(value)) ? String(Number(value)) : '—';
  };

  const metaRow = (label, value) => (
    <span className='knowledge-meta-row' key={label}>
      <span className='knowledge-meta-label'>{label}</span>
      <span className='knowledge-meta-value'>{value}</span>
    </span>
  );

  const openCreateCategory = () => {
    setCreating(false);
    setEditing(null);
    setReviewOpen(false);
    setTabMenu(null);
    setCategoryForm(EMPTY_CATEGORY_FORM);
    setCategoryOpen(true);
  };

  const openEditCategory = category => {
    setCreating(false);
    setEditing(null);
    setReviewOpen(false);
    setTabMenu(null);
    setCategoryForm(categoryFormFromRow(category));
    setCategoryOpen(true);
  };

  const saveCategory = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = categoryPayload(categoryForm.visibility, categoryForm.name.trim(), categoryForm.requireAuth);
      const saved = categoryForm.id
        ? unwrap(await API.put(`/api/knowledge-admin/categories/${categoryForm.id}`, payload))
        : unwrap(await API.post('/api/knowledge-admin/categories', payload));
      setCategoryOpen(false);
      setCategoryForm(EMPTY_CATEGORY_FORM);
      await loadCategories();
      if (saved?.id) setScope(`c:${saved.id}`);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async category => {
    setSaving(true);
    setError('');
    try {
      unwrap(await API.delete(`/api/knowledge-admin/categories/${category.id}`));
      setConfirming(null);
      setTabMenu(null);
      await Promise.all([loadCategories(), loadLibraries()]);
      if (scope === `c:${category.id}`) {
        setScope('personal');
        setPerson(null);
        setDeptKey('all');
      }
    } catch (cause) {
      setError(await errorMessage(cause));
      setConfirming(null);
    } finally {
      setSaving(false);
    }
  };

  const loadReviewCount = async () => {
    try {
      const data = unwrap(await API.get('/api/knowledge-admin/subscription-applications?page=1&page_size=1&status=pending'));
      setReviewTotal(Number(data?.total) || 0);
    } catch {
      // Count is advisory chrome; keep the last known total on refresh failure.
    }
  };

  const loadReviews = async (page = 1) => {
    setReviewLoading(true);
    setError('');
    try {
      const data = unwrap(await API.get(`/api/knowledge-admin/subscription-applications?page=${page}&page_size=${REVIEW_PAGE_SIZE}&status=pending`));
      setReviewItems(Array.isArray(data?.items) ? data.items : []);
      setReviewTotal(Number(data?.total) || 0);
      setReviewPage(Number(data?.page) || page);
    } catch (cause) {
      setReviewItems([]);
      setReviewTotal(0);
      setError(await errorMessage(cause));
    } finally {
      setReviewLoading(false);
    }
  };

  const openReviews = () => {
    setOpened(null);
    setPerson(null);
    setCreating(false);
    setEditing(null);
    setCategoryOpen(false);
    setReviewOpen(true);
    void loadReviews(1);
  };

  const submitReview = async decision => {
    if (!reviewing) return;
    setSaving(true);
    setError('');
    try {
      unwrap(await API.post(`/api/knowledge-admin/subscription-applications/${reviewing.id}/review`, { decision }));
      setReviewing(null);
      await loadReviews(reviewPage);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const reviewPageCount = Math.max(1, Math.ceil(reviewTotal / REVIEW_PAGE_SIZE) || 1);

  const showChrome = !reviewOpen && !opened;

  return <div className='knowledge-admin'>
    <div className='knowledge-sticky'>
      <header className='knowledge-page-head'>
        <div className='knowledge-page-title'>
          <h1>知识库</h1>
          {!reviewOpen && <p>按分类管理知识库与人员目录中的文件</p>}
        </div>
      </header>
      {showChrome && <div className='knowledge-chrome'>
        <div
          className='knowledge-tabs'
          role='tablist'
          aria-label='知识库分类'
          onScroll={() => { if (tabMenu) setTabMenu(null); }}
        >
          {tabs.map(tab => {
            const menuOpen = tabMenu?.key === tab.key;
            const classes = [
              'knowledge-tab',
              scope === tab.key ? 'active' : '',
              menuOpen ? 'is-menu-open' : '',
            ].filter(Boolean).join(' ');
            return <div key={tab.key} className={classes}>
              <button
                type='button'
                role='tab'
                aria-selected={scope === tab.key}
                onClick={() => { setPerson(null); setDeptKey('all'); setTabMenu(null); setScope(tab.key); }}
              >
                {tab.label}<span>{countsByScope[tab.key] || 0}</span>
              </button>
              {tab.category && <div className='knowledge-tab-menu'>
                <button
                  type='button'
                  className='knowledge-tab-more'
                  aria-label={`更多操作 ${tab.label}`}
                  aria-haspopup='menu'
                  aria-expanded={menuOpen}
                  tabIndex={-1}
                  onClick={event => {
                    event.stopPropagation();
                    setCardMenuId(null);
                    if (menuOpen) {
                      setTabMenu(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setTabMenu({
                      key: tab.key,
                      category: tab.category,
                      top: Math.round(rect.bottom + 4),
                      left: Math.round(Math.min(rect.left, window.innerWidth - 130)),
                    });
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>}
            </div>;
          })}
        </div>
        <div className='knowledge-chrome-actions'>
          <button type='button' className='knowledge-ghost' onClick={openReviews}>
            <ClipboardList size={15} />订阅审核
            {reviewTotal > 0 && <i className='knowledge-review-count' aria-label={`待审核 ${reviewTotal} 条`}>{reviewTotal > 99 ? '99+' : reviewTotal}</i>}
          </button>
          <button type='button' className='knowledge-secondary' onClick={openCreateCategory}>
            <FolderPlus size={15} />新建知识库分类
          </button>
        </div>
      </div>}
    </div>
    {tabMenu?.category && createPortal(
      <>
        <button type='button' className='knowledge-card-menu-dismiss knowledge-tab-menu-dismiss' aria-label='关闭菜单' onClick={() => setTabMenu(null)} />
        <div
          className='knowledge-card-menu-panel knowledge-tab-menu-panel'
          role='menu'
          style={{ top: tabMenu.top, left: tabMenu.left }}
        >
          <button type='button' role='menuitem' onClick={() => openEditCategory(tabMenu.category)}>
            <Pencil size={14} />编辑
          </button>
          <button
            type='button'
            role='menuitem'
            className='danger'
            onClick={() => {
              const category = tabMenu.category;
              setTabMenu(null);
              setConfirming({ type: 'category', category });
            }}
          >
            <Trash2 size={14} />删除
          </button>
        </div>
      </>,
      document.body,
    )}
    {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
    {reviewOpen ? <section className='knowledge-files' aria-label='订阅审核'>
      <header>
        <button type='button' className='knowledge-back' onClick={() => setReviewOpen(false)}><ArrowLeft size={16} />返回</button>
        <h2>订阅审核</h2>
      </header>
      <p className='knowledge-hint'>列出需要授权类别下的订阅申请，同意后申请人可在桌面对应分类中看到该知识库。</p>
      <div className='knowledge-table-wrap'>
        <table>
          <thead><tr><th>申请人</th><th>知识库</th><th>分类</th><th>所有者</th><th>申请时间</th><th>操作</th></tr></thead>
          <tbody>
            {reviewLoading ? <tr><td colSpan={6}>正在加载审核列表</td></tr>
              : reviewItems.length === 0 ? <tr><td colSpan={6}>暂无待审核申请</td></tr>
                : reviewItems.map(item => <tr key={item.id}>
                  <td>{item.applicant_username || ('#' + item.applicant_user_id)}</td>
                  <td>{item.knowledge_base_name || ('#' + item.knowledge_base_id)}</td>
                  <td>{item.category_name || '—'}</td>
                  <td>{item.owner_username || '—'}</td>
                  <td>{formatDate(item.created_at)}</td>
                  <td className='knowledge-ops'>
                    <button type='button' onClick={() => setReviewing(item)}>审核</button>
                  </td>
                </tr>)}
          </tbody>
        </table>
      </div>
      <div className='zjugis-table-pagination knowledge-files-pagination'>
        <span>共 {reviewTotal} 条，每页 {REVIEW_PAGE_SIZE} 条</span>
        <div>
          <button type='button' aria-label='上一页' disabled={reviewLoading || reviewPage <= 1} onClick={() => void loadReviews(reviewPage - 1)}>上一页</button>
          <span>{reviewPage} / {reviewPageCount}</span>
          <button type='button' aria-label='下一页' disabled={reviewLoading || reviewPage >= reviewPageCount} onClick={() => void loadReviews(reviewPage + 1)}>下一页</button>
        </div>
      </div>
    </section> : opened ? <section className='knowledge-files'>
      <header>
        <button type='button' className='knowledge-back' onClick={() => { closeViewer(); setOpened(null); }}><ArrowLeft size={16} />返回</button>
        <h2>{opened.name} - 文件清单</h2>
        <button type='button' className='knowledge-primary' disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>
          <Upload size={15} />{busy === 'upload' ? '正在上传' : '上传文件'}
        </button>
        <input ref={fileInput} className='knowledge-file-input' type='file' aria-label='上传文件' tabIndex={-1} disabled={busy === 'upload'} onChange={uploadFile} />
      </header>
      <p className='knowledge-hint knowledge-upload-hint'>一次上传一个文件，不超过 20MB。上传后在后台解析，列表会显示解析进度。</p>
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
          <thead><tr><th>文件名称</th><th>大小</th><th>上传时间</th><th>解析状态</th><th>切片数量</th><th>摘要</th><th>操作</th></tr></thead>
          <tbody>
            {documentsLoading ? <tr><td colSpan={7}>正在加载文件</td></tr> : documents.length === 0 ? <tr><td colSpan={7}>{fileSearch ? '没有匹配的文件' : '暂无文件'}</td></tr> : documents.map(file => {
              const state = parseState(file);
              return <tr key={file.id}>
              <td>{file.name}</td>
              <td>{formatSize(file.size)}</td>
              <td>{formatUnix(file.create_time || file.update_time)}</td>
              <td className={`knowledge-parse ${state.key}`}>{state.label}</td>
              <td>{Number.isFinite(Number(file.chunk_count)) ? file.chunk_count : '—'}</td>
              <td className='knowledge-summary' title={file.summary || ''}>{file.summary || '—'}</td>
              <td className='knowledge-ops'>
                <button type='button' disabled={busy === `${file.id}:browse`} onClick={() => runFileAction(file, 'browse')}><Eye size={14} />浏览</button>
                <button type='button' disabled={busy === `${file.id}:download`} onClick={() => runFileAction(file, 'download')}><Download size={14} />下载</button>
                <button type='button' disabled={busy === `${file.id}:chunks`} onClick={() => runFileAction(file, 'chunks')}><Layers size={14} />切片</button>
                {state.retry && <button type='button' disabled={busy === `${file.id}:parse`} onClick={() => runFileAction(file, 'parse')}><RefreshCw size={14} />重新解析</button>}
                <button type='button' onClick={() => { setSummaryFile(file); setSummaryText(file.summary || ''); }}><FileText size={14} />摘要</button>
                <button type='button' className='danger' onClick={() => setConfirming({ type: 'file', file })}><Trash2 size={14} />删除</button>
              </td>
            </tr>;
            })}
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
      {scope === 'personal' ? <div className='knowledge-directory'>
        <aside className='knowledge-directory-nav' aria-label='人员部门'>
          <p>人员</p>
          <button type='button' aria-pressed={deptKey === 'all'} className={deptKey === 'all' ? 'active' : ''} onClick={() => selectDepartment('all')}>
            <span>全部人员</span><i>{people.length}</i>
          </button>
          {departments.length > 0 && <p>部门</p>}
          {departments.map(([name, count]) => <button key={name} type='button' aria-pressed={deptKey === name} className={deptKey === name ? 'active' : ''} onClick={() => selectDepartment(name)}>
            <span>{name}</span><i>{count}</i>
          </button>)}
        </aside>
        <div className='knowledge-directory-main'>
          {person ? <section className='knowledge-files knowledge-person-files' aria-label='个人文件清单'>
            <header className='knowledge-person-file-head'>
              <button type='button' className='knowledge-back' onClick={() => { closeViewer(); setPerson(null); setPersonLibrariesOpen(false); setCardMenuId(null); }}><ArrowLeft size={16} />返回</button>
              <button
                type='button'
                className={personLibrariesOpen ? 'knowledge-person-file-title open' : 'knowledge-person-file-title'}
                aria-expanded={personLibrariesOpen}
                aria-controls='knowledge-person-libraries'
                onClick={() => {
                  setPersonLibrariesOpen(current => !current);
                  setCardMenuId(null);
                }}
              >
                <h2>{person.name} 的文件清单</h2>
                <p>{person.department || '未分配部门'} · {personLibraries.length}个知识库 · {personFilesLoading ? '…' : personFiles.length}个文件</p>
              </button>
            </header>
            {personLibrariesOpen && <section id='knowledge-person-libraries' className='knowledge-person-libraries' aria-label='个人知识库'>
              <div className='knowledge-person-libraries-head'>
                <h3>个人知识库</h3>
                <span>通过更多菜单编辑或删除知识库</span>
              </div>
              {personLibraries.length === 0
                ? <p className='knowledge-person-libraries-empty'>该人员暂无个人知识库</p>
                : <div className='knowledge-person-library-grid'>
                  {personLibraries.map(library => {
                    const filesInLibrary = personFiles.filter(file => Number(file.library_id) === Number(library.id)).length;
                    const menuOpen = cardMenuId === library.id;
                    return <article key={library.id} className={menuOpen ? 'knowledge-person-library is-menu-open' : 'knowledge-person-library'}>
                      <span className='knowledge-person-library-icon' aria-hidden='true'><Folder size={18} /></span>
                      <span className='knowledge-person-library-copy'>
                        <strong title={library.name}>{library.name}</strong>
                        <em>{personFilesLoading ? '…' : `${filesInLibrary} 个文件`}</em>
                      </span>
                      <div className='knowledge-card-menu'>
                        <button
                          type='button'
                          className='knowledge-card-more'
                          aria-label={`更多操作 ${library.name}`}
                          aria-haspopup='menu'
                          aria-expanded={menuOpen}
                          onClick={() => setCardMenuId(menuOpen ? null : library.id)}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {menuOpen && <>
                          <button type='button' className='knowledge-card-menu-dismiss' aria-label='关闭菜单' onClick={() => setCardMenuId(null)} />
                          <div className='knowledge-card-menu-panel' role='menu'>
                            <button type='button' role='menuitem' onClick={() => { setCardMenuId(null); openEdit(library); }}>
                              <Pencil size={14} />编辑
                            </button>
                            <button type='button' role='menuitem' className='danger' onClick={() => { setCardMenuId(null); setConfirming({ type: 'library', library }); }}>
                              <Trash2 size={14} />删除
                            </button>
                          </div>
                        </>}
                      </div>
                    </article>;
                  })}
                </div>}
            </section>}
            <div className='knowledge-files-toolbar'>
              <label className='knowledge-search'>
                <Search size={16} />
                <input value={personFileQuery} onChange={event => { setPersonFileQuery(event.target.value); setPersonFilePage(1); }} placeholder='搜索文件名称...' />
              </label>
            </div>
            <div className='knowledge-table-wrap'>
              <table>
                <thead><tr><th>文件名称</th><th>所属知识库</th><th>大小</th><th>上传时间</th><th>摘要</th><th>操作</th></tr></thead>
                <tbody>
                  {personFilesLoading ? <tr><td colSpan={6}>正在加载文件</td></tr>
                    : personFileRows.length === 0 ? <tr><td colSpan={6}>{personFileQuery.trim() ? '没有匹配的文件' : '暂无文件'}</td></tr>
                      : personFileRows.map(file => <tr key={`${file.library_id}:${file.id}`}>
                        <td className='knowledge-file-name'><FileText size={15} />{file.name}</td>
                        <td>{file.library_name || '—'}</td>
                        <td>{formatSizeLabel(file.size)}</td>
                        <td>{formatUnix(file.create_time || file.update_time)}</td>
                        <td className='knowledge-summary' title={file.summary || ''}>{file.summary || '—'}</td>
                        <td className='knowledge-ops'>
                          <button type='button' disabled={busy === `${file.id}:browse`} onClick={() => runFileAction(file, 'browse')}><Eye size={14} />预览</button>
                          <button type='button' disabled={busy === `${file.id}:download`} onClick={() => runFileAction(file, 'download')}><Download size={14} />下载</button>
                          <button type='button' disabled={busy === `${file.id}:chunks`} onClick={() => runFileAction(file, 'chunks')}><Layers size={14} />切片</button>
                          <button type='button' className='danger' onClick={() => setConfirming({ type: 'file', file })}><Trash2 size={14} />删除</button>
                        </td>
                      </tr>)}
                </tbody>
              </table>
            </div>
            <div className='zjugis-table-pagination knowledge-files-pagination'>
              <span>共 {shownPersonFiles.length} 条，每页 {FILE_PAGE_SIZE} 条</span>
              <div>
                <button type='button' aria-label='上一页' disabled={personFilesLoading || personFilePage <= 1} onClick={() => setPersonFilePage(page => page - 1)}>上一页</button>
                <span>{Math.min(personFilePage, personFilePageCount)} / {personFilePageCount}</span>
                <button type='button' aria-label='下一页' disabled={personFilesLoading || personFilePage >= personFilePageCount} onClick={() => setPersonFilePage(page => page + 1)}>下一页</button>
              </div>
            </div>
          </section> : <>
            <header className='knowledge-people-head'>
              <div>
                <h2>{deptKey === 'all' ? '全部人员' : deptKey} <span>({visiblePeople.length}人)</span></h2>
                <p>{departments.length === 0 ? '当前没有部门数据，先按全部人员查看。' : '选择部门查看该部门人员，点开人员查看个人知识库文件。'}</p>
              </div>
              <div className='knowledge-people-tools'>
                <label className='knowledge-search'>
                  <Search size={16} />
                  <input value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} placeholder='搜索姓名、用户名或部门' />
                </label>
                <button type='button' className='knowledge-primary' onClick={() => { setCategoryOpen(false); setEditing(null); setForm({ name: '', description: '', kind: 'personal', tags: '', category_id: 0 }); setCreating(true); }}><Plus size={16} />新建知识库</button>
              </div>
            </header>
            {usersLoading && people.length === 0 ? <p className='knowledge-empty' role='status'>正在加载人员</p>
              : visiblePeople.length === 0 ? <p className='knowledge-empty'>{peopleQuery.trim() ? '没有匹配的人员' : '暂无人员'}</p>
                : <div className='knowledge-people-grid'>
                  {visiblePeople.map(item => {
                    const usage = personUsage(item.id);
                    const color = avatarColor(item.name);
                    return <button key={item.id} type='button' className='knowledge-person' onClick={() => void openPerson(item)}>
                      <span className='knowledge-person-top'>
                        <i className='knowledge-avatar' style={{ color, background: `${color}18` }}>{personInitial(item.name)}</i>
                        <span>
                          <strong>{item.name}</strong>
                          <em>{item.username || '—'}</em>
                        </span>
                      </span>
                      <span className='knowledge-person-meta'>
                        <span>部门 {item.department || '未分配部门'}</span>
                        <span>注册 {formatDate(item.createdAt).slice(0, 10)}</span>
                        {item.status === 2 && <span className='muted'>账号已禁用</span>}
                      </span>
                      <span className='knowledge-person-stats'>
                        <span><b>{usage.libraries}</b>知识库</span>
                        <span><b>{usage.size}</b>总大小</span>
                      </span>
                    </button>;
                  })}
                </div>}
          </>}
        </div>
      </div> : <>
      <div className='knowledge-toolbar'>
        <label className='knowledge-search'><Search size={16} /><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder='搜索知识库...' /></label>
        <CustomSelect aria-label='排序' value={order} onChange={event => setOrder(event.target.value)}>
          <option value='desc'>按时间降序</option>
          <option value='asc'>按时间升序</option>
        </CustomSelect>
        <button type='button' className='knowledge-primary' onClick={() => { setCategoryOpen(false); setEditing(null); setForm({ name: '', description: '', kind: activeCategory?.type || 'personal', tags: '', category_id: activeCategory?.id || 0 }); setCreating(true); }}><Plus size={16} />新建知识库</button>
      </div>
      {loading ? <p className='knowledge-empty' role='status'>正在加载知识库</p> : visible.length === 0 ? <p className='knowledge-empty'>
        {libraries.length > 0 ? '当前分类暂无知识库。' : '暂无知识库'}
      </p> : <div className='knowledge-grid'>
        {visible.map(library => {
          const menuOpen = cardMenuId === library.id;
          return <article key={library.id} className={menuOpen ? 'knowledge-card is-menu-open' : 'knowledge-card'}>
            <header>
              <span className='knowledge-card-mark' aria-hidden='true'><Folder size={18} /></span>
              <h2 title={library.name}>{library.name}</h2>
              <div className='knowledge-card-menu'>
                <button
                  type='button'
                  className='knowledge-card-more'
                  aria-label='更多操作'
                  aria-haspopup='menu'
                  aria-expanded={menuOpen}
                  onClick={() => setCardMenuId(menuOpen ? null : library.id)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && <>
                  <button type='button' className='knowledge-card-menu-dismiss' aria-label='关闭菜单' onClick={() => setCardMenuId(null)} />
                  <div className='knowledge-card-menu-panel' role='menu'>
                    <button type='button' role='menuitem' onClick={() => { setCardMenuId(null); openEdit(library); }}>
                      <Pencil size={14} />编辑
                    </button>
                    <button type='button' role='menuitem' className='danger' onClick={() => { setCardMenuId(null); setConfirming({ type: 'library', library }); }}>
                      <Trash2 size={14} />删除
                    </button>
                  </div>
                </>}
              </div>
            </header>
            <p className={`knowledge-card-desc${library.description ? '' : ' is-empty'}`}>{library.description || '暂无描述'}</p>
            <div className='knowledge-tags'>{splitTags(library.tags).map(tag => <span key={tag}><Tag size={12} />{tag}</span>)}</div>
            <div className='knowledge-meta'>
              {metaRow('创建人', libraryCreator(library))}
              {metaRow('文件量', fileCount(library.id))}
              {metaRow('大小', librarySize(library.id))}
              {metaRow('用户访问量', visitCount(library))}
              {metaRow('每天使用量', dailyUsage(library))}
            </div>
            <div className='knowledge-card-actions'>
              <button type='button' onClick={() => openFiles(library)}><FileText size={14} />文件清单</button>
            </div>
          </article>;
        })}
      </div>}
      </>}
    </>}
    {categoryOpen && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={saveCategory}>
      <header><h2>{categoryForm.id ? '编辑知识库分类' : '新建知识库分类'}</h2><button type='button' onClick={() => setCategoryOpen(false)}>×</button></header>
      {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
      <label>类型<CustomSelect aria-label='分类类型' value={categoryForm.visibility} onChange={event => {
        const visibility = event.target.value;
        setCategoryForm(current => ({ ...current, visibility, requireAuth: visibility === 'authorized' }));
      }}>
        {CATEGORY_VISIBILITY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </CustomSelect></label>
      <label className='knowledge-switch-row'>授权访问<span className='knowledge-switch'>
        <input type='checkbox' role='switch' aria-label='授权访问' checked={categoryForm.requireAuth} onChange={event => setCategoryForm(current => ({ ...current, requireAuth: event.target.checked }))} />
        <i />
      </span></label>
      <label>名称<input autoFocus required maxLength={64} value={categoryForm.name} onChange={event => setCategoryForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入分类名称' /></label>
      <footer>
        <button type='button' onClick={() => setCategoryOpen(false)}>取消</button>
        <button type='submit' className='knowledge-primary' disabled={saving || categoryForm.name.trim() === ''}>
          {saving ? (categoryForm.id ? '正在保存' : '正在创建') : '确定'}
        </button>
      </footer>
    </form></div>}
    {creating && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={createLibrary}>
      <header><h2>新建知识库</h2><button type='button' onClick={() => setCreating(false)}>×</button></header>
      <label>名称<input autoFocus required maxLength={128} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入知识库名称' /></label>
      <label>描述<textarea maxLength={500} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder='填写知识库覆盖的内容和用途' /></label>
      {form.category_id
        ? <p className='knowledge-hint'>将创建到当前分类，可见性与该分类一致。</p>
        : <p className='knowledge-hint'>将创建为个人知识库，仅自己可见。</p>}
      <label>标签<input maxLength={200} value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} placeholder='多个标签用逗号分隔' /></label>
      <footer><button type='button' onClick={() => setCreating(false)}>取消</button><button type='submit' className='knowledge-primary' disabled={saving || form.name.trim() === ''}>{saving ? '正在创建' : '确定'}</button></footer>
    </form></div>}
    {editing && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={saveLibrary} aria-labelledby='dsh-knowledge-edit-title'>
      <header><h2 id='dsh-knowledge-edit-title'>编辑知识库</h2><button type='button' onClick={() => setEditing(null)}>×</button></header>
      {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
      <label>名称<input autoFocus required maxLength={128} value={editForm.name} onChange={event => setEditForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入知识库名称' /></label>
      <label>描述<textarea maxLength={500} value={editForm.description} onChange={event => setEditForm(current => ({ ...current, description: event.target.value }))} placeholder='填写知识库覆盖的内容和用途' /></label>
      <label>标签<input maxLength={200} value={editForm.tags} onChange={event => setEditForm(current => ({ ...current, tags: event.target.value }))} placeholder='多个标签用逗号分隔' /></label>
      <footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='submit' className='knowledge-primary' disabled={saving || editForm.name.trim() === ''}>{saving ? '正在保存' : '保存'}</button></footer>
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
            <button type='button' disabled={viewer.loading || !(viewer.library_id || opened)} onClick={() => runFileAction({ id: viewer.id, name: viewer.name, library_id: viewer.library_id }, 'download')}><Download size={16} />下载</button>
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
    {confirming && <div className='knowledge-modal-backdrop'><section className='knowledge-modal' role='dialog' aria-label='确认删除'>
      <header><h2>确认删除</h2><button type='button' onClick={() => setConfirming(null)}>×</button></header>
      <p>{confirming.type === 'library'
        ? (isPersonalLibrary(confirming.library)
          ? `确认删除个人知识库「${confirming.library.name}」？库内文件将一并移除，桌面端不再可用。`
          : `删除后将移除「${confirming.library.name}」及其文件，桌面端不再可用。`)
        : confirming.type === 'category'
          ? `确认删除「${confirming.category.name}」？分类下知识库也会同步删除。`
          : `删除文件「${confirming.file.name}」？`}</p>
      <footer>
        <button type='button' onClick={() => setConfirming(null)}>取消</button>
        <button
          type='button'
          className='remove'
          disabled={saving}
          onClick={() => {
            if (confirming.type === 'library') return removeLibrary(confirming.library);
            if (confirming.type === 'category') return removeCategory(confirming.category);
            return runFileAction(confirming.file, 'delete');
          }}
        >删除</button>
      </footer>
    </section></div>}
    {reviewing && <div className='knowledge-modal-backdrop'><section className='knowledge-modal' role='dialog' aria-label='订阅审核'>
      <header><h2>订阅审核</h2><button type='button' onClick={() => setReviewing(null)}>×</button></header>
      <p>申请人 <strong>{reviewing.applicant_username || ('#' + reviewing.applicant_user_id)}</strong> 申请订阅「{reviewing.knowledge_base_name || ('#' + reviewing.knowledge_base_id)}」。</p>
      <footer>
        <button type='button' disabled={saving} onClick={() => setReviewing(null)}>取消</button>
        <button type='button' className='remove' disabled={saving} onClick={() => void submitReview('reject')}>不同意</button>
        <button type='button' className='knowledge-primary' disabled={saving} onClick={() => void submitReview('approve')}>同意</button>
      </footer>
    </section></div>}
  </div>;
};

export default KnowledgeLibrary;
