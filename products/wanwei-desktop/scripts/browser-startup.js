// Runs before the app and dynamic plugins, including when their parsing fails.
(function () {
  var failed = false
  function showFailure() {
    var root = document.getElementById('root')
    if (failed || !root || root.childNodes.length > 0) return
    failed = true
    var panel = document.createElement('div')
    panel.style.cssText = 'margin:64px auto;padding:32px;max-width:560px;font:16px/1.8 system-ui;color:#26334b'
    var title = document.createElement('h2')
    title.textContent = '页面加载未完成'
    var detail = document.createElement('p')
    detail.textContent = '请尝试重新加载。如果仍无法打开，请向管理员提供系统版本和启动日志。'
    var button = document.createElement('button')
    button.textContent = '重新加载'
    button.onclick = function () { window.location.reload() }
    panel.appendChild(title)
    panel.appendChild(detail)
    panel.appendChild(button)
    root.appendChild(panel)
  }
  window.addEventListener('error', function () { setTimeout(showFailure, 1000) })
  window.addEventListener('unhandledrejection', function () { setTimeout(showFailure, 1000) })
  setTimeout(showFailure, 30000)
}())
