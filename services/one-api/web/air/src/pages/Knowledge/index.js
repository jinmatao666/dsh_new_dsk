import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, ClipboardList, Download, Eye, FileText, Folder, FolderPlus, FolderTree, Layers, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Tag, Trash2, Upload } from 'lucide-react';
import { API, isAdmin, isRoot } from '../../helpers';
import CustomSelect from '../../components/CustomSelect';
import './index.css';

/** @param {Array<{ id: number, parent_id?: number, sort_order?: number }>} nodes */
function orgChildrenByParent(nodes) {
  const result = new Map();
  for (const node of nodes) {
    const parentId = Number(node.parent_id) || 0;
    result.set(parentId, [...(result.get(parentId) || []), node]);
  }
  for (const list of result.values()) {
    list.sort((left, right) => (Number(left.sort_order) || 0) - (Number(right.sort_order) || 0)
      || Number(left.id) - Number(right.id));
  }
  return result;
}

/** Inclusive descendant set for one government-organization node. */
function orgDescendantIds(nodes, rootId) {
  const children = orgChildrenByParent(nodes);
  const ids = new Set([Number(rootId)]);
  const stack = [Number(rootId)];
  while (stack.length) {
    const current = stack.pop();
    for (const child of children.get(current) || []) {
      const id = Number(child.id);
      if (!ids.has(id)) {
        ids.add(id);
        stack.push(id);
      }
    }
  }
  return ids;
}

/** Signed-in user id from localStorage; 0 when missing or invalid. */
function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const id = Number(user?.id);
    return Number.isFinite(id) && id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

/** Root may manage every tab; others only tabs they created (any display name). */
function canManageCategory(category) {
  if (!category) return false;
  if (isRoot()) return true;
  const ownerId = Number(category.owner_user_id);
  return ownerId > 0 && ownerId === currentUserId();
}

/** Category dialog: 个人/公开/授权 maps to type + require_auth (self-only / everyone / subscribe). */
const CATEGORY_VISIBILITY = [
  ['personal', '个人'],
  ['public', '公开'],
  ['authorized', '授权'],
];

const EMPTY_CATEGORY_FORM = { id: 0, name: '', visibility: 'personal' };

function categoryPayload(visibility, name) {
  const type = visibility === 'public' ? 'common' : visibility === 'authorized' ? 'shared' : 'personal';
  return { name, type, require_auth: type !== 'common' };
}

function categoryFormFromRow(category) {
  const visibility = category.type === 'common' ? 'public' : category.type === 'shared' ? 'authorized' : 'personal';
  return {
    id: Number(category.id) || 0,
    name: category.name || '',
    visibility,
  };
}

const FILE_PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 20;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const PARSE_POLL_MS = 2500;
const COVER_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const EMPTY_LIBRARY_FORM = { name: '', description: '', kind: 'personal', tags: '', category_id: 0, cover: '', source: 'create', ragflow_dataset_id: '' };

/** Read a local image as a data URL. OneAPI stores a compact JPEG.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readCoverFile(file) {
  if (!COVER_MIME.has(file.type)) return Promise.reject(new Error('请上传 PNG、JPEG、WebP 或 GIF 图片'));
  if (file.size > MAX_COVER_BYTES) return Promise.reject(new Error('封面图片不能超过 8MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string' || !value.startsWith('data:image/')) {
        reject(new Error('封面图片无效'));
        return;
      }
      resolve(value);
    };
    reader.onerror = () => reject(new Error('封面图片无效'));
    reader.readAsDataURL(file);
  });
}

function CoverPicker({ value, onChange, onError, onReading }) {
  return (
    <div className='knowledge-cover-field'>
      <span className='knowledge-cover-label'>封面</span>
      {value
        ? <img src={value} alt='' />
        : <p className='knowledge-hint'>未选择图片。上传后显示在知识库广场。</p>}
      <div className='knowledge-cover-actions'>
        <label className='knowledge-cover-pick'>
          选择图片
          <input
            type='file'
            accept='image/png,image/jpeg,image/webp,image/gif'
            aria-label='上传封面'
            onChange={event => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (!file) return;
              onReading(true);
              readCoverFile(file).then(onChange).catch(cause => onError(cause instanceof Error ? cause.message : '封面图片无效')).finally(() => onReading(false));
            }}
          />
        </label>
        {value ? <button type='button' onClick={() => onChange('')}>移除封面</button> : null}
      </div>
    </div>
  );
}

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

/** Workbench catalog APIs: root full catalog vs signed-in scoped routes. */
function knowledgeBasesRoot() {
  return isRoot() ? '/api/knowledge-admin/bases' : '/api/knowledge-bases';
}

function knowledgeCategoriesUrl() {
  // Both paths filter by the caller; keep the workbench alias for consistency.
  return '/api/knowledge-admin/categories';
}

function ragflowDatasetsUrl() {
  return '/api/knowledge-bases/ragflow-datasets';
}

/** Loads document total and summed byte size for one library card. */
async function loadLibraryDocumentStats(libraryId) {
  let page = 1;
  let total = 0;
  let bytes = 0;
  let seen = 0;
  for (; page <= STATS_MAX_PAGES; page += 1) {
    const result = unwrapDocumentPage(await API.get(
      `${knowledgeBasesRoot()}/${libraryId}/documents?${documentsQuery({ page, pageSize: STATS_PAGE_SIZE })}`,
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
  const [editForm, setEditForm] = useState({ name: '', description: '', tags: '', cover: '' });
  const [opened, setOpened] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [documentTotal, setDocumentTotal] = useState(0);
  const [filePage, setFilePage] = useState(1);
  const [fileKeyword, setFileKeyword] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [coverReading, setCoverReading] = useState(false);
  const [form, setForm] = useState(EMPTY_LIBRARY_FORM);
  const [ragflowDatasets, setRagflowDatasets] = useState([]);
  const [ragflowDatasetsLoading, setRagflowDatasetsLoading] = useState(false);
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
  const [orgNodes, setOrgNodes] = useState([]);
  const [orgMemberships, setOrgMemberships] = useState([]);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [orgExpanded, setOrgExpanded] = useState({});
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
    const rows = unwrap(await API.get(knowledgeBasesRoot()));
    setLibraries(Array.isArray(rows) ? rows : []);
  };

  const loadCategories = async () => {
    const rows = unwrap(await API.get(knowledgeCategoriesUrl()));
    // Copy so later in-place mock/store mutations cannot clear the rendered tab list.
    setCategories(Array.isArray(rows) ? rows.map(row => ({ ...row })) : []);
  };

  const loadUsers = async () => {
    // Root browses every account; ordinary users receive peer labels from the scoped directory.
    if (!isRoot()) {
      return;
    }
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

  const loadOrganization = async () => {
    setOrgError('');
    try {
      if (isRoot()) {
        const [nodesResponse, membersResponse] = await Promise.all([
          API.get('/api/government-organization/'),
          API.get('/api/government-organization/memberships'),
        ]);
        if (!nodesResponse.data?.success || !Array.isArray(nodesResponse.data.data)) {
          throw new Error(nodesResponse.data?.message || '读取组织架构失败');
        }
        if (!membersResponse.data?.success || !Array.isArray(membersResponse.data.data?.memberships)) {
          throw new Error(membersResponse.data?.message || '读取组织成员失败');
        }
        setOrgNodes(nodesResponse.data.data);
        setOrgMemberships(membersResponse.data.data.memberships);
        return;
      }
      const directory = unwrap(await API.get('/api/knowledge-bases/organization-directory'));
      setOrgNodes(Array.isArray(directory?.nodes) ? directory.nodes : []);
      setOrgMemberships(Array.isArray(directory?.memberships) ? directory.memberships : []);
      const peerUsers = Array.isArray(directory?.users) ? directory.users : [];
      setUsers(peerUsers.map(user => ({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        status: 1,
        created_at: '',
      })));
    } catch (cause) {
      setOrgNodes([]);
      setOrgMemberships([]);
      if (!isRoot()) setUsers([]);
      setOrgError(cause.response?.data?.message || cause.message || '读取组织架构失败');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setUsersLoading(true);
    setOrgLoading(true);
    const boot = async () => {
      try {
        // Fetch before setState so a slow boot cannot wipe categories saved after mount.
        const categoryRows = unwrap(await API.get(knowledgeCategoriesUrl()));
        const libraryRows = unwrap(await API.get(knowledgeBasesRoot()));
        if (cancelled) return;
        setCategories(Array.isArray(categoryRows) ? categoryRows.map(row => ({ ...row })) : []);
        setLibraries(Array.isArray(libraryRows) ? libraryRows : []);
        await loadReviewCount();
        if (cancelled) return;
        if (isRoot()) {
          await Promise.all([loadUsers(), loadOrganization()]);
        } else {
          await loadOrganization();
        }
      } catch (cause) {
        if (!cancelled) setError(await errorMessage(cause));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setUsersLoading(false);
          setOrgLoading(false);
        }
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!creating) {
      return undefined;
    }
    let cancelled = false;
    setRagflowDatasetsLoading(true);
    const load = async () => {
      try {
        const rows = unwrap(await API.get(ragflowDatasetsUrl()));
        if (!cancelled) setRagflowDatasets(Array.isArray(rows) ? rows : []);
      } catch (cause) {
        if (!cancelled) {
          setRagflowDatasets([]);
          setError(await errorMessage(cause));
        }
      } finally {
        if (!cancelled) setRagflowDatasetsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [creating]);

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

  // Root browses every personal library; others browse the same directory UI scoped to their org peers.
  const manageAllPersonal = isRoot();
  const viewerId = currentUserId();
  const canManagePersonalLibrary = library => (
    manageAllPersonal || (Number(library?.owner_user_id) === viewerId && isAdmin())
  );

  const countsByScope = useMemo(() => {
    const personalRows = libraries.filter(item => item.kind === 'personal' && !Number(item.category_id || 0));
    const counts = { personal: personalRows.length };
    categories.forEach(category => {
      counts[`c:${category.id}`] = libraries.filter(item => Number(item.category_id || 0) === category.id).length;
    });
    return counts;
  }, [libraries, categories]);
  // Categories already come scoped from the API (owned / public / accessible). Do not filter by tab name.
  const tabs = useMemo(() => [
    { key: 'personal', label: '个人知识库', category: null },
    ...categories.map(category => ({ key: `c:${category.id}`, label: category.name, category })),
  ], [categories]);
  // Clamp without setState so creating a tab cannot race a reset back to personal.
  const activeScope = tabs.some(tab => tab.key === scope) ? scope : 'personal';
  const activeCategory = categories.find(category => `c:${category.id}` === activeScope);

  // Prefer account display_name over login username / raw id for every creator label on this page.
  const userDisplayById = useMemo(() => {
    const map = new Map();
    for (const user of users) {
      const id = Number(user.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      const label = String(user.display_name || user.username || '').trim();
      if (label) map.set(id, label);
    }
    return map;
  }, [users]);

  const resolveUserLabel = (userId, fallback = '') => {
    const id = Number(userId);
    if (Number.isFinite(id) && id > 0) {
      const known = userDisplayById.get(id);
      if (known) return known;
    }
    const text = String(fallback || '').trim();
    if (text) return text;
    if (Number.isFinite(id) && id > 0) return `用户 ${id}`;
    return '—';
  };

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    const categoryId = activeScope.startsWith('c:') ? Number(activeScope.slice(2)) : 0;
    return libraries
      .filter(item => (categoryId
        ? Number(item.category_id || 0) === categoryId
        : item.kind === activeScope && !Number(item.category_id || 0)))
      .filter(item => {
        if (!text) return true;
        const creator = resolveUserLabel(item.owner_user_id, item.owner_username);
        return [item.name, item.description, item.tags, creator].some(value => String(value || '').toLowerCase().includes(text));
      })
      .sort((left, right) => {
        const delta = new Date(left.updated_at || left.created_at).getTime() - new Date(right.updated_at || right.created_at).getTime();
        return order === 'asc' ? delta : -delta;
      });
  }, [libraries, activeScope, keyword, order, userDisplayById]);

  const orgById = useMemo(() => new Map(orgNodes.map(node => [Number(node.id), node])), [orgNodes]);
  const orgChildren = useMemo(() => orgChildrenByParent(orgNodes), [orgNodes]);
  const rootOrgNodes = useMemo(() => orgChildren.get(0) || [], [orgChildren]);

  // Default the personal directory to the first top-level organization node (or unassigned when none).
  useEffect(() => {
    if (orgLoading || selectedOrgId != null) return;
    const first = rootOrgNodes[0];
    if (first) {
      setSelectedOrgId(Number(first.id));
      return;
    }
    if (!manageAllPersonal) setSelectedOrgId('unassigned');
  }, [orgLoading, selectedOrgId, rootOrgNodes, manageAllPersonal]);
  const membershipsByUser = useMemo(() => {
    const map = new Map();
    orgMemberships.forEach(row => {
      const userId = Number(row.user_id);
      const nodeId = Number(row.node_id);
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(nodeId) || nodeId <= 0) return;
      map.set(userId, [...(map.get(userId) || []), nodeId]);
    });
    return map;
  }, [orgMemberships]);
  const membersByNode = useMemo(() => {
    const map = new Map();
    orgMemberships.forEach(row => {
      const userId = Number(row.user_id);
      const nodeId = Number(row.node_id);
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(nodeId) || nodeId <= 0) return;
      map.set(nodeId, [...(map.get(nodeId) || []), userId]);
    });
    return map;
  }, [orgMemberships]);

  const orgPathLabel = useMemo(() => {
    const cache = new Map();
    const labelFor = nodeId => {
      if (cache.has(nodeId)) return cache.get(nodeId);
      const names = [];
      const seen = new Set();
      for (let current = orgById.get(nodeId); current && !seen.has(current.id); current = orgById.get(Number(current.parent_id) || 0)) {
        seen.add(current.id);
        names.unshift(current.name);
      }
      const label = names.join(' / ');
      cache.set(nodeId, label);
      return label;
    };
    return labelFor;
  }, [orgById]);

  const people = useMemo(() => {
    const map = new Map();
    users.forEach(user => {
      const id = Number(user.id);
      if (!Number.isFinite(id) || id <= 0) return;
      // Ordinary users only browse themselves; root keeps the full roster.
      if (!manageAllPersonal && viewerId > 0 && id !== viewerId) return;
      const name = String(user.display_name || user.username || '').trim() || `用户 ${id}`;
      const nodeIds = membershipsByUser.get(id) || [];
      const department = nodeIds.map(orgPathLabel).filter(Boolean).join('；') || '';
      map.set(id, {
        id,
        name,
        username: String(user.username || ''),
        department,
        nodeIds,
        createdAt: user.created_at || '',
        status: Number(user.status) || 1,
      });
    });
    libraries.filter(isPersonalLibrary).forEach(library => {
      const id = Number(library.owner_user_id);
      if (!Number.isFinite(id) || id <= 0 || map.has(id)) return;
      if (!manageAllPersonal && viewerId > 0 && id !== viewerId) return;
      const name = String(library.owner_username || '').trim() || `用户 ${id}`;
      const nodeIds = membershipsByUser.get(id) || [];
      map.set(id, {
        id,
        name,
        username: name,
        department: nodeIds.map(orgPathLabel).filter(Boolean).join('；') || '',
        nodeIds,
        createdAt: '',
        status: 1,
      });
    });
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh'));
  }, [users, libraries, membershipsByUser, orgPathLabel, manageAllPersonal, viewerId]);

  const assignedUserIds = useMemo(() => {
    const ids = new Set();
    membershipsByUser.forEach((_, userId) => ids.add(userId));
    return ids;
  }, [membershipsByUser]);

  const unassignedPeople = useMemo(
    () => people.filter(item => !assignedUserIds.has(item.id)),
    [people, assignedUserIds],
  );

  const subtreeMemberCount = useMemo(() => {
    const counts = new Map();
    const countFor = nodeId => {
      if (counts.has(nodeId)) return counts.get(nodeId);
      const ids = new Set(membersByNode.get(nodeId) || []);
      for (const child of orgChildren.get(nodeId) || []) {
        for (const userId of countFor(Number(child.id))) ids.add(userId);
      }
      counts.set(nodeId, ids);
      return ids;
    };
    orgNodes.forEach(node => countFor(Number(node.id)));
    return counts;
  }, [orgNodes, orgChildren, membersByNode]);

  const selectedOrgNode = selectedOrgId === 'unassigned' || selectedOrgId == null
    ? null
    : orgById.get(Number(selectedOrgId));

  const visiblePeople = useMemo(() => {
    const text = peopleQuery.trim().toLowerCase();
    let scoped = [];
    if (selectedOrgId === 'unassigned') {
      scoped = unassignedPeople;
    } else if (selectedOrgId != null && Number.isFinite(Number(selectedOrgId))) {
      const allowed = orgDescendantIds(orgNodes, Number(selectedOrgId));
      scoped = people.filter(item => (item.nodeIds || []).some(nodeId => allowed.has(nodeId)));
    }
    return scoped.filter(item => {
      if (!text) return true;
      return [item.name, item.username, item.department].some(value => String(value || '').toLowerCase().includes(text));
    });
  }, [people, unassignedPeople, selectedOrgId, peopleQuery, orgNodes]);

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
        `${knowledgeBasesRoot()}/${library.id}/documents?${documentsQuery({ page, keywords })}`,
      ));
      let nextPage = result.page || page;
      const totalPages = Math.max(1, Math.ceil(result.total / FILE_PAGE_SIZE) || 1);
      if (result.total > 0 && nextPage > totalPages) {
        const fallback = unwrapDocumentPage(await API.get(
          `${knowledgeBasesRoot()}/${library.id}/documents?${documentsQuery({ page: totalPages, keywords })}`,
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
        `${knowledgeBasesRoot()}/${library.id}/documents?${documentsQuery({ page, pageSize: 100 })}`,
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
      cover: typeof library.cover === 'string' ? library.cover : '',
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
        cover: editForm.cover,
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
    if (form.source === 'existing' && !form.ragflow_dataset_id) {
      setError('请选择已有知识库');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const kind = form.category_id ? form.kind : 'personal';
      const created = unwrap(await API.post(knowledgeBasesRoot(), {
        name: form.name.trim(),
        description: form.description.trim(),
        kind,
        tags: form.tags.trim(),
        ...(form.category_id ? { category_id: form.category_id } : {}),
        ...(form.cover ? { cover: form.cover } : {}),
        ...(form.source === 'existing' && form.ragflow_dataset_id
          ? { ragflow_dataset_id: form.ragflow_dataset_id }
          : {}),
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
      setForm(EMPTY_LIBRARY_FORM);
      setRagflowDatasets([]);
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
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    if (selected.length === 0 || !opened) return;
    const candidates = selected.filter(file => !isSkippedUploadName(file.name));
    if (candidates.length === 0) {
      setError('不支持上传该文件');
      return;
    }
    if (candidates.some(file => file.size > MAX_UPLOAD_BYTES)) {
      setError('文件不能超过 20MB');
      return;
    }
    setBusy('upload');
    setError('');
    const failures = [];
    try {
      for (const file of candidates) {
        try {
          const body = new FormData();
          body.append('file', file);
          unwrap(await API.post(`${knowledgeBasesRoot()}/${opened.id}/documents`, body));
        } catch (cause) {
          failures.push(`${file.name}：${await errorMessage(cause)}`);
        }
      }
      setFileKeyword('');
      setFileSearch('');
      setFilePage(1);
      await loadDocuments(opened, { page: 1, keywords: '' });
      if (failures.length > 0) {
        setError(failures.length === candidates.length
          ? failures.join('；')
          : `部分文件上传失败：${failures.join('；')}`);
      }
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
    const base = `${knowledgeBasesRoot()}/${libraryId}/documents/${documentId}`;
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
      if (isAdmin()) {
        const data = unwrap(await API.get(`/api/knowledge-admin/bases/${libraryId}/documents/${file.id}/chunk-viewer`));
        const url = typeof data?.url === 'string' ? data.url.trim() : '';
        if (!url) throw new Error('切片页面地址无效');
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const rows = unwrap(await API.get(`${knowledgeBasesRoot()}/${libraryId}/documents/${file.id}/chunks`));
      const content = (Array.isArray(rows) ? rows : [])
        .map(item => String(item?.content || '').trim())
        .filter(Boolean)
        .join('\n\n');
      setViewer(current => {
        revokeViewerUrl(current);
        return {
          id: file.id,
          library_id: libraryId,
          name: file.name,
          loading: false,
          mode: 'text',
          content: content || '暂无切片',
        };
      });
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
      const base = `${knowledgeBasesRoot()}/${libraryId}/documents/${file.id}`;
      if (action === 'download') {
        const response = await API.get(`${base}/file`, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        const link = window.document.createElement('a');
        link.href = url;
        link.download = file.name || 'download';
        link.click();
        URL.revokeObjectURL(url);
      } else if (action === 'parse') {
        if (!isAdmin()) throw new Error('无权重新解析');
        unwrap(await API.post(`/api/knowledge-admin/bases/${libraryId}/documents/${file.id}/parse`));
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

  const selectOrgNode = key => {
    closeViewer();
    setPerson(null);
    setSelectedOrgId(key);
    setPeopleQuery('');
  };

  const toggleOrgExpanded = nodeId => {
    setOrgExpanded(current => ({ ...current, [nodeId]: current[nodeId] === false }));
  };

  const renderOrgBranch = (parentId = 0, depth = 0) => (orgChildren.get(parentId) || []).map(node => {
    const nodeId = Number(node.id);
    const childNodes = orgChildren.get(nodeId) || [];
    const hasChildren = childNodes.length > 0;
    const open = orgExpanded[nodeId] !== false;
    const count = subtreeMemberCount.get(nodeId)?.size || 0;
    const active = Number(selectedOrgId) === nodeId;
    return <React.Fragment key={nodeId}>
      <div className={active ? 'knowledge-org-node active' : 'knowledge-org-node'} style={{ paddingLeft: 8 + depth * 14 }}>
        <button
          type='button'
          className='knowledge-org-expand'
          disabled={!hasChildren}
          aria-label={`${open ? '收起' : '展开'}${node.name}`}
          onClick={() => hasChildren && toggleOrgExpanded(nodeId)}
        >
          {hasChildren ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}
        </button>
        <button
          type='button'
          className='knowledge-org-label'
          aria-pressed={active}
          onClick={() => {
            selectOrgNode(nodeId);
            if (hasChildren && orgExpanded[nodeId] === false) toggleOrgExpanded(nodeId);
          }}
        >
          <FolderTree size={15} />
          <span>{node.name}</span>
          {node.kind ? <small>{node.kind}</small> : null}
          <i>{count}</i>
        </button>
      </div>
      {hasChildren && open ? renderOrgBranch(nodeId, depth + 1) : null}
    </React.Fragment>;
  });

  const fileCount = id => {
    if (!(id in counts)) return '…';
    return counts[id] == null ? '—' : `${counts[id]}个`;
  };

  const librarySize = id => {
    if (!(id in sizes)) return '…';
    return sizes[id] == null ? '—' : formatSizeLabel(sizes[id]);
  };

  const libraryCreator = library => resolveUserLabel(library.owner_user_id, library.owner_username);

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
      const payload = categoryPayload(categoryForm.visibility, categoryForm.name.trim());
      const saved = categoryForm.id
        ? unwrap(await API.put(`/api/knowledge-admin/categories/${categoryForm.id}`, payload))
        : unwrap(await API.post('/api/knowledge-admin/categories', payload));
      setCategoryOpen(false);
      setCategoryForm(EMPTY_CATEGORY_FORM);
      // Apply the saved row immediately so the new tab appears even if a slow initial
      // categories fetch resolves afterward with a stale empty list.
      if (saved?.id) {
        setCategories(current => {
          const next = current.filter(row => Number(row.id) !== Number(saved.id));
          next.push({ ...saved });
          return next.sort((left, right) => Number(left.id) - Number(right.id));
        });
        setScope(`c:${saved.id}`);
      }
      await loadCategories();
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
        setSelectedOrgId(null);
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
          {!reviewOpen && <p>{manageAllPersonal
            ? '按分类管理知识库与人员目录中的文件'
            : '管理本组织与自己的个人知识库，以及自己创建或已获授权的分类知识库'}</p>}
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
              activeScope === tab.key ? 'active' : '',
              menuOpen ? 'is-menu-open' : '',
            ].filter(Boolean).join(' ');
            return <div key={tab.key} className={classes}>
              <button
                type='button'
                role='tab'
                aria-selected={activeScope === tab.key}
                onClick={() => { setPerson(null); setSelectedOrgId(null); setTabMenu(null); setScope(tab.key); }}
              >
                {tab.label}<span>{countsByScope[tab.key] || 0}</span>
              </button>
              {tab.category && canManageCategory(tab.category) && <div className='knowledge-tab-menu'>
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
                : reviewItems.map(item => {
                  const ownerId = item.owner_user_id
                    || libraries.find(library => Number(library.id) === Number(item.knowledge_base_id))?.owner_user_id;
                  return <tr key={item.id}>
                  <td>{resolveUserLabel(item.applicant_user_id, item.applicant_username)}</td>
                  <td>{item.knowledge_base_name || ('#' + item.knowledge_base_id)}</td>
                  <td>{item.category_name || '—'}</td>
                  <td>{resolveUserLabel(ownerId, item.owner_username)}</td>
                  <td>{formatDate(item.created_at)}</td>
                  <td className='knowledge-ops'>
                    <button type='button' onClick={() => setReviewing(item)}>审核</button>
                  </td>
                </tr>;
                })}
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
        <input ref={fileInput} className='knowledge-file-input' type='file' multiple aria-label='上传文件' tabIndex={-1} disabled={busy === 'upload'} onChange={uploadFile} />
      </header>
      <p className='knowledge-hint knowledge-upload-hint'>可一次选择多个文件，每个不超过 20MB。上传后在后台解析，列表会显示解析进度。</p>
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
                {isAdmin() && state.retry && <button type='button' disabled={busy === `${file.id}:parse`} onClick={() => runFileAction(file, 'parse')}><RefreshCw size={14} />重新解析</button>}
                {isAdmin() && <button type='button' onClick={() => { setSummaryFile(file); setSummaryText(file.summary || ''); }}><FileText size={14} />摘要</button>}
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
      {activeScope === 'personal' ? <div className='knowledge-directory'>
        <aside className='knowledge-directory-nav knowledge-org-nav' aria-label='组织架构'>
          <p>组织架构</p>
          {orgLoading ? <p className='knowledge-org-hint' role='status'>正在加载组织架构</p>
            : orgError ? <div className='knowledge-org-error' role='alert'>
              <p>读取组织架构失败</p>
              <small>{orgError}</small>
              <button type='button' onClick={() => { setOrgLoading(true); void loadOrganization().finally(() => setOrgLoading(false)); }}>重新加载</button>
            </div>
              : orgNodes.length === 0
                ? <p className='knowledge-org-hint'>{manageAllPersonal
                  ? '暂无组织节点。请先在用户权限 → 组织架构中创建。'
                  : '您尚未分配到组织节点，可在「未分配组织」中查看自己的个人知识库。'}</p>
                : <div className='knowledge-org-tree'>{renderOrgBranch()}</div>}
          {!orgLoading && !orgError && unassignedPeople.length > 0 && (manageAllPersonal || orgNodes.length === 0) && <button
            type='button'
            aria-pressed={selectedOrgId === 'unassigned'}
            className={selectedOrgId === 'unassigned' ? 'knowledge-org-unassigned active' : 'knowledge-org-unassigned'}
            onClick={() => selectOrgNode('unassigned')}
          >
            <span>未分配组织</span><i>{unassignedPeople.length}</i>
          </button>}
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
                      {canManagePersonalLibrary(library) && <div className='knowledge-card-menu'>
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
                      </div>}
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
                      : personFileRows.map(file => {
                        const ownedLibrary = personLibraries.find(library => Number(library.id) === Number(file.library_id));
                        const canDeleteFile = canManagePersonalLibrary(ownedLibrary || { owner_user_id: person?.id });
                        return <tr key={`${file.library_id}:${file.id}`}>
                        <td className='knowledge-file-name'><FileText size={15} />{file.name}</td>
                        <td>{file.library_name || '—'}</td>
                        <td>{formatSizeLabel(file.size)}</td>
                        <td>{formatUnix(file.create_time || file.update_time)}</td>
                        <td className='knowledge-summary' title={file.summary || ''}>{file.summary || '—'}</td>
                        <td className='knowledge-ops'>
                          <button type='button' disabled={busy === `${file.id}:browse`} onClick={() => runFileAction(file, 'browse')}><Eye size={14} />预览</button>
                          <button type='button' disabled={busy === `${file.id}:download`} onClick={() => runFileAction(file, 'download')}><Download size={14} />下载</button>
                          <button type='button' disabled={busy === `${file.id}:chunks`} onClick={() => runFileAction(file, 'chunks')}><Layers size={14} />切片</button>
                          {canDeleteFile && <button type='button' className='danger' onClick={() => setConfirming({ type: 'file', file })}><Trash2 size={14} />删除</button>}
                        </td>
                      </tr>;
                      })}
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
                <h2>{selectedOrgId == null
                  ? '选择组织'
                  : selectedOrgId === 'unassigned'
                    ? '未分配组织'
                    : (selectedOrgNode?.name || '组织')} <span>{selectedOrgId == null ? '' : `(${visiblePeople.length}人)`}</span></h2>
                <p>{orgLoading ? '正在加载组织架构…'
                  : orgError ? '组织架构未能加载，请在左侧重试。'
                    : orgNodes.length === 0
                      ? (manageAllPersonal
                        ? '请先在用户权限 → 组织架构中创建节点并分配成员。'
                        : '点开人员查看个人知识库文件。')
                      : selectedOrgId == null ? '按组织架构查看人员；点开人员查看个人知识库文件。'
                        : '点开人员查看个人知识库文件。'}</p>
              </div>
              <div className='knowledge-people-tools'>
                <label className='knowledge-search'>
                  <Search size={16} />
                  <input value={peopleQuery} onChange={event => setPeopleQuery(event.target.value)} placeholder='搜索姓名、用户名或组织' disabled={selectedOrgId == null} />
                </label>
                <button type='button' className='knowledge-primary' onClick={() => { setCategoryOpen(false); setEditing(null); setForm(EMPTY_LIBRARY_FORM); setCreating(true); }}><Plus size={16} />新建知识库</button>
              </div>
            </header>
            {selectedOrgId == null
              ? <p className='knowledge-empty'>请从左侧选择组织节点</p>
              : usersLoading && people.length === 0 ? <p className='knowledge-empty' role='status'>正在加载人员</p>
                : visiblePeople.length === 0 ? <p className='knowledge-empty'>{peopleQuery.trim() ? '没有匹配的人员' : '该组织下暂无人员'}</p>
                  : <div className='knowledge-people-grid'>
                    {visiblePeople.map(item => {
                      const usage = personUsage(item.id);
                      const color = avatarColor(item.name);
                      return <button key={item.id} type='button' className='knowledge-person' onClick={() => void openPerson(item)}>
                        <span className='knowledge-person-top'>
                          <i className='knowledge-avatar' style={{ color, background: `${color}18` }}>{personInitial(item.name)}</i>
                          <span>
                            <strong>{item.name}</strong>
                          </span>
                        </span>
                        <span className='knowledge-person-meta'>
                          <span>组织 {item.department || '未分配组织'}</span>
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
        <button type='button' className='knowledge-primary' onClick={() => { setCategoryOpen(false); setEditing(null); setForm({ ...EMPTY_LIBRARY_FORM, kind: activeCategory?.type || 'personal', category_id: activeCategory?.id || 0 }); setCreating(true); }}><Plus size={16} />新建知识库</button>
      </div>
      {loading ? <p className='knowledge-empty' role='status'>正在加载知识库</p> : visible.length === 0 ? <p className='knowledge-empty'>
        {libraries.length > 0 ? '当前分类暂无知识库。' : '暂无知识库'}
      </p> : <div className='knowledge-grid'>
        {visible.map(library => {
          const menuOpen = cardMenuId === library.id;
          return <article key={library.id} className={menuOpen ? 'knowledge-card is-menu-open' : 'knowledge-card'}>
            <header>
              <span className={typeof library.cover === 'string' && library.cover.startsWith('data:image/') ? 'knowledge-card-mark has-cover' : 'knowledge-card-mark'} aria-hidden='true'>
                {typeof library.cover === 'string' && library.cover.startsWith('data:image/')
                  ? <img src={library.cover} alt='' />
                  : <Folder size={18} />}
              </span>
              <h2 title={library.name}>{library.name}</h2>
              {isAdmin() && <div className='knowledge-card-menu'>
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
              </div>}
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
        setCategoryForm(current => ({ ...current, visibility: event.target.value }));
      }}>
        {CATEGORY_VISIBILITY.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </CustomSelect></label>
      <p className='knowledge-hint'>{categoryForm.visibility === 'public'
        ? '公开：所有登录用户可见该分类下知识库'
        : categoryForm.visibility === 'authorized'
          ? '授权：订阅审核通过后，申请人可见'
          : '个人：仅创建者可见，其他人看不到该分类下知识库'}</p>
      <label>名称<input autoFocus required maxLength={64} value={categoryForm.name} onChange={event => setCategoryForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入分类名称' /></label>
      <footer>
        <button type='button' onClick={() => setCategoryOpen(false)}>取消</button>
        <button type='submit' className='knowledge-primary' disabled={saving || categoryForm.name.trim() === ''}>
          {saving ? (categoryForm.id ? '正在保存' : '正在创建') : '确定'}
        </button>
      </footer>
    </form></div>}
    {creating && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={createLibrary}>
      <header><h2>新建知识库</h2><button type='button' onClick={() => { setCreating(false); setForm(EMPTY_LIBRARY_FORM); setRagflowDatasets([]); }}>×</button></header>
      <div className='knowledge-modal-body'>
        <label>创建方式<select aria-label='创建方式' value={form.source} onChange={event => setForm(current => ({
          ...current,
          source: event.target.value,
          ragflow_dataset_id: event.target.value === 'existing' ? current.ragflow_dataset_id : '',
        }))}>
          <option value='create'>新建空白知识库</option>
          <option value='existing'>选择已有知识库</option>
        </select></label>
        {form.source === 'existing' && <label>已有知识库<select
          aria-label='已有知识库'
          required
          value={form.ragflow_dataset_id}
          disabled={ragflowDatasetsLoading}
          onChange={event => {
            const id = event.target.value;
            const selected = ragflowDatasets.find(item => item.id === id);
            setForm(current => ({
              ...current,
              ragflow_dataset_id: id,
              name: current.name.trim() === '' && selected?.name ? selected.name : current.name,
            }));
          }}
        >
          <option value=''>{ragflowDatasetsLoading ? '正在加载…' : '请选择已有知识库'}</option>
          {ragflowDatasets.map(item => (
            <option key={item.id} value={item.id}>{item.name || item.id}</option>
          ))}
        </select></label>}
        {form.source === 'existing' && !ragflowDatasetsLoading && ragflowDatasets.length === 0
          && <p className='knowledge-hint'>暂无可关联的已有知识库。请先在知识库管理平台创建，或选择新建空白知识库。</p>}
        <label>名称<input autoFocus required maxLength={128} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入知识库名称' /></label>
        <label>描述<textarea maxLength={500} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder='填写知识库覆盖的内容和用途' /></label>
        <CoverPicker value={form.cover} onChange={cover => setForm(current => ({ ...current, cover }))} onError={setError} onReading={setCoverReading} />
        <label>标签<input maxLength={200} value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} placeholder='多个标签用逗号分隔' /></label>
        {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
      </div>
      <footer>
        <button type='button' onClick={() => { setCreating(false); setForm(EMPTY_LIBRARY_FORM); setRagflowDatasets([]); }}>取消</button>
        <button
          type='submit'
          className='knowledge-primary'
          disabled={saving || coverReading || form.name.trim() === '' || (form.source === 'existing' && !form.ragflow_dataset_id)}
        >{saving ? '正在创建' : '确定'}</button>
      </footer>
    </form></div>}
    {editing && <div className='knowledge-modal-backdrop'><form className='knowledge-modal' onSubmit={saveLibrary} aria-labelledby='dsh-knowledge-edit-title'>
      <header><h2 id='dsh-knowledge-edit-title'>编辑知识库</h2><button type='button' onClick={() => setEditing(null)}>×</button></header>
      <div className='knowledge-modal-body'>
        {error && <div className='knowledge-alert' role='alert'>{error}<button type='button' onClick={() => setError('')}>关闭</button></div>}
        <label>名称<input autoFocus required maxLength={128} value={editForm.name} onChange={event => setEditForm(current => ({ ...current, name: event.target.value }))} placeholder='请输入知识库名称' /></label>
        <label>描述<textarea maxLength={500} value={editForm.description} onChange={event => setEditForm(current => ({ ...current, description: event.target.value }))} placeholder='填写知识库覆盖的内容和用途' /></label>
        <CoverPicker value={editForm.cover} onChange={cover => setEditForm(current => ({ ...current, cover }))} onError={setError} onReading={setCoverReading} />
        <label>标签<input maxLength={200} value={editForm.tags} onChange={event => setEditForm(current => ({ ...current, tags: event.target.value }))} placeholder='多个标签用逗号分隔' /></label>
      </div>
      <footer><button type='button' onClick={() => setEditing(null)}>取消</button><button type='submit' className='knowledge-primary' disabled={saving || coverReading || editForm.name.trim() === ''}>{saving ? '正在保存' : '保存'}</button></footer>
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
      <p>申请人 <strong>{resolveUserLabel(reviewing.applicant_user_id, reviewing.applicant_username)}</strong> 申请订阅「{reviewing.knowledge_base_name || ('#' + reviewing.knowledge_base_id)}」。</p>
      <footer>
        <button type='button' disabled={saving} onClick={() => setReviewing(null)}>取消</button>
        <button type='button' className='remove' disabled={saving} onClick={() => void submitReview('reject')}>不同意</button>
        <button type='button' className='knowledge-primary' disabled={saving} onClick={() => void submitReview('approve')}>同意</button>
      </footer>
    </section></div>}
  </div>;
};

export default KnowledgeLibrary;
