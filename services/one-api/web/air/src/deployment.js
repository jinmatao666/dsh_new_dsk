/** Public runtime configuration injected by the backend before the bundle loads. */
export const deployment = typeof window !== 'undefined' ? window.__DSH_DEPLOYMENT__ || {} : {};
export const adminPrefix = deployment.adminPrefix || '';
export const apiPrefix = deployment.apiPrefix || '';
const absolute = value => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
/** Resolve an internal admin route; absolute URLs and existing prefixes remain intact. */
export function adminURL(value) {
  if (!value || absolute(value) || !value.startsWith('/')) return value;
  if (adminPrefix && (value === adminPrefix || value.startsWith(adminPrefix + '/'))) return value;
  return adminPrefix + value;
}
/** Resolve a browser API path against the external API prefix. */
export function apiURL(value) {
  if (!value || absolute(value) || !value.startsWith('/')) return value;
  if (apiPrefix && (value === apiPrefix || value.startsWith(apiPrefix + '/'))) return value;
  return apiPrefix + value;
}
/** Choose the API prefix for API/download resources and admin prefix for built-in assets. */
export function resourceURL(value) {
  return /^(?:\/api(?:\/|$)|\/v1(?:beta)?(?:\/|$)|\/downloads(?:\/|$)|\/desktop-updates(?:\/|$))/.test(value || '') ? apiURL(value) : adminURL(value);
}
