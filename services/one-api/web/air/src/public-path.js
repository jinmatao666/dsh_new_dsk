/* global __webpack_public_path__: writable */
import { adminPrefix } from './deployment';
// Webpack uses this for lazy chunks, CSS and emitted assets at every route depth.
// Vite has no free `__webpack_public_path__` binding; fall back to a global assign.
const publicPath = adminPrefix + '/';
try {
  __webpack_public_path__ = publicPath;
} catch {
  globalThis.__webpack_public_path__ = publicPath;
}
