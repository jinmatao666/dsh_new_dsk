(() => {
  if (window.top !== window.self || location.origin !== __WANWEI_ORIGIN__) return;
  if (typeof AbortSignal.any === 'function') return;

  // Weak ownership lets completed gateway requests release their combined signal
  // even when the application's lifetime signal remains active.
  const controllers = new WeakMap();
  const finalizers = new FinalizationRegistry(cleanup => cleanup());
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;

  function connect(sources, target) {
    const subscriptions = [];
    const token = {};
    const cleanup = () => {
      for (const [source, listener] of subscriptions) source.removeEventListener('abort', listener);
      subscriptions.length = 0;
      finalizers.unregister(token);
    };
    for (const source of sources) {
      const listener = () => {
        const signal = target.deref();
        cleanup();
        if (signal) controllers.get(signal).abort(source.reason);
      };
      subscriptions.push([source, listener]);
      source.addEventListener('abort', listener, { once: true });
    }
    finalizers.register(target.deref(), cleanup, token);
  }

  Object.defineProperty(AbortSignal, 'any', {
    configurable: true, writable: true,
    value: function any(signals) {
      if (signals == null || typeof signals[Symbol.iterator] !== 'function') {
        throw new TypeError('AbortSignal.any requires an iterable of AbortSignals');
      }
      const sources = Array.from(signals);
      // Validate the entire sequence before accepting an already-aborted source.
      for (const source of sources) aborted.call(source);
      const controller = new AbortController();
      for (const source of sources) {
        if (source.aborted) {
          controller.abort(source.reason);
          return controller.signal;
        }
      }
      if (sources.length) {
        controllers.set(controller.signal, controller);
        connect(new Set(sources), new WeakRef(controller.signal));
      }
      return controller.signal;
    },
  });
})();
