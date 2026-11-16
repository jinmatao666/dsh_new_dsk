#!/usr/bin/env python3
"""Exercise the real GTK shell and native bridge against loopback test pages."""
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve().parent

MAIN = r"""<!doctype html><html><body><h1>Kylin shell smoke</h1><script>
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const invoke = (command, args) => window.__ZJUGIS_NATIVE_INVOKE__(command, args);
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function waitForReports() {
  for (let n = 0; n < 100; n++) {
    const reports = await fetch('/reports').then(r => r.json());
    if (reports.length === 2) return reports;
    await pause(100);
  }
  throw new Error('Expert pages did not finish their native roundtrips');
}
async function run() {
  for (let n = 0; !window.__ZJUGIS_NATIVE_INVOKE__ && n < 100; n++) await pause(50);
  check(typeof window.__ZJUGIS_NATIVE_INVOKE__ === 'function', 'Main native bridge missing');
  check(window.__TAURI__.core.invoke === window.__ZJUGIS_NATIVE_INVOKE__, 'Shared client alias missing');
  await invoke('set_auth_window_state', { authenticated: true });
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
  await fetch('/result', {method:'POST', body:JSON.stringify({passed:true, reports})});
  await invoke('kylin_smoke_exit', {passed:true});
}
run().catch(async error => {
  await fetch('/result', {method:'POST', body:JSON.stringify({passed:false,error:String(error)})});
  if (window.__ZJUGIS_NATIVE_INVOKE__) invoke('kylin_smoke_exit', {passed:false});
});
</script></body></html>"""

EXPERT = r"""<!doctype html><html><body><input value="Expert focus"><script>
window.probeCounter = 42;
(async () => {
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
                elif path == "/fixture":
                    body, content_type = json.dumps({"path": str(fixture), "content": fixture.read_text()}), "application/json"
                else:
                    body, content_type = (EXPERT if path == "/expert" else MAIN), "text/html; charset=utf-8"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.end_headers()
                self.wfile.write(body.encode())

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                (reports if self.path == "/report" else results).append(payload)
                self.send_response(200)
                self.end_headers()

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = dict(os.environ, WANWEI_KYLIN_SMOKE_URL="http://127.0.0.1:" + str(server.server_port),
                   WEBKIT_DISABLE_COMPOSITING_MODE="1", XDG_DATA_HOME=directory,
                   XDG_RUNTIME_DIR=directory, GDK_BACKEND="x11", NO_AT_BRIDGE="1", LANG="C.UTF-8")
        target = pathlib.Path(env.get("CARGO_TARGET_DIR", HERE / "target"))
        binary = target / "debug/wanwei-buddy-kylin"
        try:
            completed = subprocess.run(["dbus-run-session", "--", "xvfb-run", "-a", str(binary)],
                                       cwd=HERE, env=env, text=True, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, timeout=60)
            (HERE / "smoke.log").write_text(completed.stdout)
            print(completed.stdout)
            if completed.returncode != 0 or not results or not results[-1].get("passed"):
                raise RuntimeError("Native shell smoke failed: " + json.dumps(results))
            print("Kylin native shell: shared file command, expert IPC authorization, ticket bootstrap, same-window geometry, visibility, state, close and logout passed")
        finally:
            server.shutdown()


if __name__ == "__main__":
    run()
