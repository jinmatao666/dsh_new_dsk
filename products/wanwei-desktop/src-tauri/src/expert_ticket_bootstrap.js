(() => {
  const launch = __WANWEI_EXPERT_LAUNCH__;
  if (window.top !== window.self
      || location.origin !== launch.origin
      || location.pathname !== launch.path
      || location.search !== launch.search) return;
  // 只在首次工作台文档注入；刷新使用网站会话，不重放已兑换的票据。
  if (sessionStorage.getItem(launch.marker) !== null) return;
  history.replaceState(null, '', location.pathname + location.search + launch.fragment);
  sessionStorage.setItem(launch.marker, '1');
})();
