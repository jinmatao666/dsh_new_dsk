import { API } from './api';

const ROLE_READ_ERROR = '角色服务暂时不可用，请稍后重试';
const ROLE_CACHE_TTL = 30000;

let roleCache = null;
let roleCacheUpdatedAt = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeServerMessage = (value) => {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message || message.length > 200 || /<\/?(?:html|head|body|script|object|embed)\b/i.test(message)) {
    return ROLE_READ_ERROR;
  }
  return message;
};

const parseRoleResponse = (response) => {
  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (typeof response.data === 'string' || (contentType && !contentType.includes('application/json'))) {
    throw new Error(ROLE_READ_ERROR);
  }
  if (!response.data?.success) {
    throw new Error(safeServerMessage(response.data?.message));
  }
  if (!Array.isArray(response.data.data)) {
    throw new Error(ROLE_READ_ERROR);
  }
  return response.data.data;
};

const writeRoleCache = (roles) => {
  roleCache = roles.map((role) => ({ ...role }));
  roleCacheUpdatedAt = Date.now();
  return roleCache;
};

/** Keep a successfully created or updated role visible across tab switches. */
export function cacheManagedRole(role) {
  if (!role || roleCache === null) return;
  const next = roleCache.filter((candidate) => Number(candidate.role) !== Number(role.role));
  next.push({ ...role });
  writeRoleCache(next.sort((left, right) => Number(left.role) - Number(right.role)));
}

/** Read the authoritative role list and retry one transient or non-JSON response. */
export async function fetchManagedRoles() {
  if (roleCache !== null && Date.now() - roleCacheUpdatedAt < ROLE_CACHE_TTL) {
    return roleCache;
  }
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await API.get('/api/role/', {
        headers: { Accept: 'application/json' },
        params: { role_refresh: Date.now() },
        timeout: 10000,
      });
      return writeRoleCache(parseRoleResponse(response));
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(350);
    }
  }
  console.error(ROLE_READ_ERROR, lastError);
  const status = lastError?.response?.status;
  if (roleCache !== null && status !== 401 && status !== 403) {
    return roleCache;
  }
  throw new Error(ROLE_READ_ERROR);
}
