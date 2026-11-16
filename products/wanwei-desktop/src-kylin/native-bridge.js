(() => {
  if (window.top !== window.self || location.origin !== __WANWEI_ORIGIN__) return;
  const nonce = __WANWEI_NONCE__;
  const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const pending = new Map();
  let sequence = 0;
  const invoke = (command, args = {}) => new Promise((resolve, reject) => {
    if (pending.size >= 128) return reject(new Error('原生请求过多，请稍后重试'));
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('原生请求超时，请检查操作结果后再重试'));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    try {
      window.webkit.messageHandlers.wanwei.postMessage(JSON.stringify({ nonce, documentId, id, command, args }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
  Object.defineProperty(window, '__WANWEI_NATIVE_REPLY__', { configurable: true, value: reply => {
    if (reply.documentId !== documentId) return;
    const request = pending.get(reply.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(reply.id);
    if (reply.ok) request.resolve(reply.value);
    else request.reject(new Error(reply.error));
  } });
  Object.defineProperty(window, '__ZJUGIS_NATIVE_INVOKE__', { configurable: true, value: invoke });
  const api = window.__TAURI__ || {};
  api.core = { ...api.core, invoke };
  api.tauri = { ...api.tauri, invoke };
  window.__TAURI__ = api;
})();
