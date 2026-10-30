/* global __webpack_public_path__: writable */
import { adminPrefix } from './deployment';
// Webpack uses this for lazy chunks, CSS and emitted assets at every route depth.
__webpack_public_path__ = adminPrefix + '/';
