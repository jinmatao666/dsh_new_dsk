#!/usr/bin/env python3
"""Exercise the real GTK shell and native bridge against loopback test pages."""
import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve().parent

MAIN = r"""<!doctype html><html><body><button id=pointer style="position:absolute;left:10px;top:10px;width:180px;height:50px">Main pointer probe</button><input id=typing style="position:absolute;left:210px;top:10px;width:180px;height:50px"><script>
let pointerClicks = 0;
document.getElementById('pointer').onclick = event => { if (event.isTrusted) pointerClicks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (command, args) => window.__ZJUGIS_NATIVE_INVOKE__(command, args);
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function clickMain() {
  const before = pointerClicks;
  const rect = document.getElementById('pointer').getBoundingClientRect();
  await fetch('/pointer', {method:'POST', body:JSON.stringify({x:rect.x+rect.width/2,y:rect.y+rect.height/2})});
  for (let n = 0; n < 30 && pointerClicks === before; n++) await pause(50);
  check(pointerClicks === before + 1, 'Main view did not receive real mouse click');
}
async function waitForReports() {
  for (let n = 0; n < 100; n++) {
    const reports = await fetch('/reports').then(r => r.json());
    if (reports.length === 2) return reports;
    await pause(100);
  }
  throw new Error('Expert pages did not finish their native roundtrips');
}
async function run() {
  check(typeof AbortSignal.any === 'function', 'AbortSignal.any missing at page startup');
  check(typeof AbortSignal.prototype.throwIfAborted === 'function', 'AbortSignal.throwIfAborted missing');
  check(typeof AbortSignal.timeout === 'function', 'AbortSignal.timeout missing');
  check('reason' in AbortSignal.prototype, 'AbortSignal.reason missing');
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/gateway-probe.js'; script.onload = resolve; script.onerror = reject;
    document.head.appendChild(script);
  });
  check(await window.__WANWEI_KYLIN_GATEWAY_PROBE__(), 'Production Gateway browser probe failed');
  for (let n = 0; !window.__ZJUGIS_NATIVE_INVOKE__ && n < 100; n++) await pause(50);
  check(typeof window.__ZJUGIS_NATIVE_INVOKE__ === 'function', 'Main native bridge missing');
  check(window.__TAURI__.core.invoke === window.__ZJUGIS_NATIVE_INVOKE__, 'Shared client alias missing');
  check(Array.isArray(await window.__TAURI__.core.invoke('list_custom_skills')), 'Shared skill client native call failed');
  await invoke('set_auth_window_state', { authenticated: true });
  await pause(400);
  await clickMain();
  const typing = document.getElementById('typing');
  const typingRect = typing.getBoundingClientRect();
  await fetch('/pointer', {method:'POST', body:JSON.stringify({x:typingRect.x+20,y:typingRect.y+20,text:'main keyboard probe'})});
  for (let n = 0; n < 30 && typing.value !== 'main keyboard probe'; n++) await pause(50);
  check(typing.value === 'main keyboard probe', 'Main keyboard input failed after pointer focus');
  const labels = [];
  for (let i = 0; i < 2; i++) {
    labels.push(await invoke('open_expert_webview', {
      key:'smoke-' + i, ticket: 'a'.repeat(63) + i, url:location.origin + '/expert?index=' + i,
      x:30 + 400 * i, y:120, width:360, height:400,
    }));
  }
  const reports = await waitForReports();
  check(reports.every(r => r.roundtrip && r.denied && r.ticket), 'Expert IPC, authorization or ticket bootstrap failed');
  for (const label of labels) await invoke('set_expert_webview_visible', { label, visible:true });
  await pause(600);
  await clickMain();
  await fetch('/pointer', {method:'POST', body:JSON.stringify({x:100,y:150})});
  let inputReports = [];
  for (let n = 0; n < 30; n++) {
    inputReports = await fetch('/inputs').then(r => r.json());
    if (inputReports.length) break;
    await pause(50);
  }
  check(inputReports.some(r => r.index === '0' && r.trusted), 'Embedded expert did not receive real mouse click');
  let snapshot = await invoke('kylin_smoke_snapshot');
  check(snapshot.experts.length === 2, 'Expected two embedded native views');
  check(snapshot.experts.every(e => e.sameWindow && e.visible), 'Expert is not visible in main window');
  for (let i = 0; i < labels.length; i++) {
    await invoke('set_expert_webview_bounds', { label:labels[i], x:40 + 400*i, y:170, width:340, height:380 });
    await invoke('set_expert_webview_visible', { label:labels[i], visible:false });
    await invoke('set_expert_webview_visible', { label:labels[i], visible:true });
  }
  await pause(600);
  snapshot = await invoke('kylin_smoke_snapshot');
  for (let i = 0; i < labels.length; i++) {
    const expert = snapshot.experts.find(e => e.label === labels[i]);
    check(JSON.stringify(expert.bounds) === JSON.stringify([40 + 400*i,170,340,380]), 'Actual GTK geometry differs');
    check(expert.counter === 42, 'Expert JavaScript state was lost after hide/show');
  }
  await invoke('close_expert_webview', { label: labels[0] });
  check((await invoke('kylin_smoke_snapshot')).experts.length === 1, 'Closing expert did not dispose native view');
  document.title = '__zjugis_native_auth:login';
  await pause(400);
  check((await invoke('kylin_smoke_snapshot')).experts.length === 0, 'Logout did not clear expert views');
  await clickMain();
  await fetch('/result', {method:'POST', body:JSON.stringify({passed:true, reports})});
  await invoke('kylin_smoke_exit', {passed:true});
}
run().catch(async error => {
  await fetch('/result', {method:'POST', body:JSON.stringify({passed:false,error:String(error)})});
  if (window.__ZJUGIS_NATIVE_INVOKE__) invoke('kylin_smoke_exit', {passed:false});
});
</script></body></html>"""

EXPERT = r"""<!doctype html><html><body><button style="position:absolute;left:10px;top:10px;width:180px;height:50px" onclick="fetch('/input',{method:'POST',body:JSON.stringify({index:new URLSearchParams(location.search).get('index'),trusted:event.isTrusted})})">Expert pointer probe</button><script>
window.probeCounter = 42;
(async () => {
  if (typeof AbortSignal.any !== 'function') throw new Error('Expert AbortSignal.any missing');
  const fixture = await fetch('/fixture').then(r => r.json());
  const invoke = window.__ZJUGIS_NATIVE_INVOKE__;
  const content = await invoke('read_analysis_view', {path:fixture.path});
  let denied = false;
  try { await invoke('set_auth_window_state', {authenticated:false}); }
  catch (error) { denied = true; }
  const ticket = location.hash.includes('ticket=') || location.search.includes('ticket=');
  await fetch('/report', {method:'POST',body:JSON.stringify({roundtrip:content === fixture.content,denied,ticket})});
})();
</script></body></html>"""


def run():
    reports = []
    results = []
    inputs = []
    probe_path = os.environ.get("WANWEI_KYLIN_GATEWAY_PROBE")
    gateway_probe = (pathlib.Path(probe_path).read_text() if probe_path else subprocess.check_output(
        ["node", str(HERE.parent / "scripts/build-kylin-browser-probe.mjs")], text=True))
    with tempfile.TemporaryDirectory(prefix="wanwei-kylin-smoke-") as directory:
        fixture = pathlib.Path(directory) / "smoke-analysis-view_20261116.json"
        fixture.write_text('{"source":"native-file-roundtrip"}')

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                path = self.path.split("?", 1)[0]
                if path == "/reports":
                    body, content_type = json.dumps(reports), "application/json"
                elif path == "/inputs":
                    body, content_type = json.dumps(inputs), "application/json"
                elif path == "/fixture":
                    body, content_type = json.dumps({"path": str(fixture), "content": fixture.read_text()}), "application/json"
                elif path == "/gateway-probe.js":
                    body, content_type = gateway_probe, "text/javascript; charset=utf-8"
                else:
                    body, content_type = (EXPERT if path == "/expert" else MAIN), "text/html; charset=utf-8"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.end_headers()
                self.wfile.write(body.encode())

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path == "/pointer":
                    windows = subprocess.check_output(["xdotool", "search", "--onlyvisible", "--name", "^万维Buddy$"], text=True).splitlines()
                    subprocess.run(["xdotool", "mousemove", "--sync", "--window", windows[-1],
                                    str(round(payload["x"])), str(round(payload["y"])), "click", "1"], check=True)
                    if "text" in payload:
                        subprocess.run(["xdotool", "type", "--clearmodifiers", "--", payload["text"]], check=True)
                else:
                    (reports if self.path == "/report" else inputs if self.path == "/input" else results).append(payload)
                self.send_response(200)
                self.end_headers()

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = dict(os.environ, WANWEI_KYLIN_SMOKE_URL="http://127.0.0.1:" + str(server.server_port),
                   XDG_DATA_HOME=directory,
                   XDG_RUNTIME_DIR=directory, GDK_BACKEND="x11", NO_AT_BRIDGE="1", LANG="C.UTF-8")
        for name in ("WEBKIT_DISABLE_COMPOSITING_MODE", "LIBGL_ALWAYS_SOFTWARE"):
            env.pop(name, None)
        target = pathlib.Path(env.get("CARGO_TARGET_DIR", HERE / "target"))
        binary = target / "debug/wanwei-buddy-kylin"
        try:
            completed = subprocess.run([str(binary)],
                                       cwd=HERE, env=env, text=True, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, timeout=60)
            (HERE / "smoke.log").write_text(completed.stdout)
            print(completed.stdout)
            if completed.returncode != 0 or not results or not results[-1].get("passed"):
                raise RuntimeError("Native shell smoke failed: " + json.dumps(results))
            print("Kylin native shell: browser cancellation APIs, production Gateway delivery/restart/disposal, shared native skill/workspace clients, real main/expert mouse clicks, file command, expert authorization, ticket bootstrap, geometry, visibility, state, close and logout passed")
        finally:
            server.shutdown()


if __name__ == "__main__":
    if "--display" in sys.argv:
        run()
    else:
        subprocess.run(["dbus-run-session", "--", "xvfb-run", "-a", sys.executable, str(HERE / "smoke.py"), "--display"], check=True)
