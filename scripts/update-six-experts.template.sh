#!/usr/bin/env bash
# Six-site update only: the existing gateway and OneAPI containers are not modified.
set -Eeuo pipefail
umask 077
ROOT=/root/dsh-experts
VERSION=@VERSION@
ARCHIVE="wanwei-six-experts-$VERSION.tar.gz"
RELEASE="$ROOT/releases/$VERSION"
NAMES=(meeting-minutes document-processing file-conversion geology third-survey planning-review)
die() { echo "$*" >&2; exit 1; }
for tool in docker curl tar sha256sum realpath; do command -v "$tool" >/dev/null || die "缺少 $tool"; done
docker compose version >/dev/null
name_ok() { case "$1" in meeting-minutes|document-processing|file-conversion|geology|third-survey|planning-review) ;; *) die '专家目录名不正确';; esac; }
project_for() { if [ "$1" = meeting-minutes ]; then echo wanwei-meeting; else echo "wanwei-$1"; fi; }
service_for() { if [ "$1" = meeting-minutes ]; then echo meeting; else echo expert; fi; }
port_for() { case "$1" in meeting-minutes) echo 3301;; document-processing) echo 3302;; file-conversion) echo 3303;; geology) echo 3304;; third-survey) echo 3305;; planning-review) echo 3306;; esac; }
volume_for() { case "$1" in meeting-minutes) echo meeting-data;; document-processing) echo document-data;; file-conversion) echo conversion-data;; geology) echo geology-data;; third-survey) echo third-survey-data;; planning-review) echo planning-review-data;; esac; }
container_for() {
  local ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$(project_for "$1")" --filter "label=com.docker.compose.service=$(service_for "$1")" --filter 'label=com.docker.compose.oneoff=False')"
  [ -n "$ids" ] && [ "$(echo "$ids" | wc -l)" = 1 ] || die "$1 未找到唯一的现有容器"
  echo "$ids"
}
current_dir() {
  local dir
  dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$1")"
  dir="$(realpath -e "$dir")"
  case "$dir" in "$ROOT"/*) ;; *) die "现有目录不在 $ROOT";; esac
  test -f "$dir/.env" && test -f "$dir/compose.local-xinference.yml" || die '现有目录缺少配置'
  echo "$dir"
}
assert_existing() {
  local name="$1" id actual expected mode
  id="$(container_for "$name")"; current_dir "$id" >/dev/null
  actual="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$id")"
  expected="$(project_for "$name")_$(volume_for "$name")"
  [ "$actual" = "$expected" ] || die "$name 数据卷不匹配；停止更新"
  mode="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$id")"
  [ "$mode" = host ] || die "$name 不是现有 host 网络部署；停止更新"
}
compose_new() {
  local name="$1"; shift
  (cd "$RELEASE/expert-web/$name" && docker compose -p "$(project_for "$name")" -f compose.local-xinference.yml -f "$RELEASE/$name.image.yml" "$@")
}
ready() {
  local port; port="$(port_for "$1")"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/readyz" >/dev/null 2>&1; then echo "$1 $port READY"; return 0; fi
    sleep 2
  done
  return 1
}
check() {
  for name in "${NAMES[@]}"; do assert_existing "$name"; done
  (cd "$ROOT" && sha256sum -c "$ARCHIVE.sha256")
  # Invalid input probes routing only; this cannot create a usage event.
  local code
  code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"event_id":"","user_id":0}' http://127.0.0.1:13300/api/expert-web/usage)"
  [ "$code" = 400 ] || die "OneAPI 使用上报接口未确认可用（HTTP $code）；先确认后台 usage 版本已部署"
  for name in "${NAMES[@]}"; do ready "$name" || die "$name 当前未就绪"; done
  echo '检查通过；未构建、未重启、未修改网关或 OneAPI。'
}
prepare() {
  test ! -e "$RELEASE" || die '发布目录已存在；不会覆盖。已准备好请执行 update-all'
  check
  local listing
  listing="$(tar -tzf "$ROOT/$ARCHIVE")"
  if echo "$listing" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then die '源码包路径不安全'; fi
  mkdir -p "$RELEASE"
  tar -xzf "$ROOT/$ARCHIVE" --no-same-owner -C "$RELEASE"
  for name in "${NAMES[@]}"; do
    grep -q 'def report_usage' "$RELEASE/expert-web/$name/server.py" || die "$name 源码缺少使用上报"
    local id old image backup
    id="$(container_for "$name")"; old="$(current_dir "$id")"
    cp "$old/.env" "$RELEASE/expert-web/$name/.env"
    chmod 600 "$RELEASE/expert-web/$name/.env"
    printf '%s\n' "$old" > "$RELEASE/$name.previous-dir"
    image="$(docker inspect -f '{{.Image}}' "$id")"; backup="wanwei-expert-backup/$name:$VERSION"
    docker image tag "$image" "$backup"
    printf 'services:\n  %s:\n    image: %s\n    pull_policy: never\n' "$(service_for "$name")" "$backup" > "$RELEASE/$name.rollback.yml"
    printf 'services:\n  %s:\n    image: wanwei-expert/%s:%s\n    pull_policy: never\n' "$(service_for "$name")" "$name" "$VERSION" > "$RELEASE/$name.image.yml"
    compose_new "$name" config --quiet
    echo "$name：已保留现有配置、数据卷和旧镜像，未重启。"
  done
  echo '准备完成。确认没有正在处理的任务后，执行 update-all。'
}
update_one() {
  local name="$1" id old
  name_ok "$name"; assert_existing "$name"
  test -f "$RELEASE/$name.image.yml" || die '请先运行 prepare'
  id="$(container_for "$name")"; old="$(current_dir "$id")"
  if [ "$old" != "$RELEASE/expert-web/$name" ]; then cp "$old/.env" "$RELEASE/expert-web/$name/.env"; fi
  chmod 600 "$RELEASE/expert-web/$name/.env"
  if grep -q 'replace-with-' "$RELEASE/expert-web/$name/.env"; then die "$name 配置仍有占位符"; fi
  compose_new "$name" build
  compose_new "$name" run --rm --no-deps --entrypoint python "$(service_for "$name")" deployment.py
  compose_new "$name" run --rm --no-deps --entrypoint python "$(service_for "$name")" -c 'import inspect,server; assert callable(server.report_usage); assert "report_usage" in inspect.getsource(server.create_server); print("usage reporter included")'
  compose_new "$name" up -d --no-build
  ready "$name" || die "$name 未就绪；执行 bash $ROOT/update-six-experts-$VERSION.sh rollback $name"
}
rollback_one() {
  local name="$1" old; name_ok "$name"
  test -f "$RELEASE/$name.previous-dir" && test -f "$RELEASE/$name.rollback.yml" || die '未找到回退记录'
  old="$(realpath -e "$(cat "$RELEASE/$name.previous-dir")")"
  case "$old" in "$ROOT"/*) ;; *) die '旧目录不在部署目录内';; esac
  test -f "$old/.env" || die '旧配置已丢失'
  assert_existing "$name"
  (cd "$old" && docker compose -p "$(project_for "$name")" -f compose.local-xinference.yml -f "$RELEASE/$name.rollback.yml" up -d --no-build)
  ready "$name" || die "$name 回退后未就绪"
}
case "${1:-}" in
  check) check;;
  prepare) prepare;;
  update) update_one "${2:-}";;
  update-all) for name in "${NAMES[@]}"; do update_one "$name"; done;;
  rollback) rollback_one "${2:-}";;
  status) for name in "${NAMES[@]}"; do ready "$name" || true; done;;
  *) die "用法：bash update-six-experts-$VERSION.sh check|prepare|update-all|update <目录名>|rollback <目录名>|status";;
esac
