// Candidate initialization script for the isolated Linux Tauri 1 shell.
// JavaScript transport only: native authorization remains the shell's responsibility.
(() => {
  const api = window.__TAURI__;
  const invoke = api?.tauri?.invoke;
  if (typeof invoke !== 'function') {
    throw new Error('Tauri 1 invoke API is unavailable');
  }
  const forward = (command, args) => invoke(command, args);
  Object.defineProperty(window, '__ZJUGIS_NATIVE_INVOKE__', {
    value: forward, configurable: true,
  });
  // Four existing product clients read the Tauri 2 namespace directly.
  // Only the Linux compatibility shell would install this alias.
  Object.defineProperty(api, 'core', {
    value: Object.freeze({ invoke: forward }), configurable: true,
  });
})();
