(() => {
  let active = false;
  let count = 0;
  let lastPointer = -Infinity;
  let resizeTimer;
  const tags = new Set(['button', 'input', 'textarea', 'select', 'a', 'div', 'span', 'svg', 'path']);
  const tag = node => node instanceof Element ? (tags.has(node.localName) ? node.localName : 'other') : 'none';
  const send = (event, source) => {
    if (!active || count >= 300) return;
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') return;
    count++;
    const target = source?.target;
    const x = Math.round(source?.clientX ?? 0);
    const y = Math.round(source?.clientY ?? 0);
    const hit = document.elementFromPoint(x, y);
    // Never collect text, attributes, URLs, keyboard keys or input values.
    void invoke('expert_input_diagnostic', { event: {
      event, tag: tag(target), hitTag: tag(hit), x, y,
      width: innerWidth, height: innerHeight, focused: document.hasFocus(),
      interactive: target instanceof Element && !!target.closest('button,a,input,select,textarea,[role="button"],[role="option"]'),
      blocked: source?.defaultPrevented === true,
    } }).catch(() => {}); // Diagnostic failure must not affect normal interaction.
  };
  window.addEventListener('wanwei:expert-diagnostics-start', () => { active = true; send('start'); });
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(type, event => {
      if (!event.isTrusted) return;
      if (type === 'pointerdown') {
        if (performance.now() - lastPointer < 100) return;
        lastPointer = performance.now();
      }
      send(type, event);
      if (type === 'click') setTimeout(() => send('settled-click', event), 0);
    }, true);
  }
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => send('resize'), 150);
  });
  for (const type of ['focus', 'blur', 'wanwei:feature-open']) {
    window.addEventListener(type, () => send(type === 'wanwei:feature-open' ? 'feature-open' : type));
  }
})();
