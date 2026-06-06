#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
START_WAIT_SECONDS="${START_WAIT_SECONDS:-10}"
OBSERVER_NODE_MAX_OLD_SPACE_MB="${OBSERVER_NODE_MAX_OLD_SPACE_MB:-192}"
OBSERVER_NODE_SEMI_SPACE_MB="${OBSERVER_NODE_SEMI_SPACE_MB:-8}"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8787}"
SESSIONS_DIR="${CODEX_SESSIONS_DIR:-$HOME/.codex/sessions}"
CLAUDE_DIR="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"

usage() {
  cat <<EOF
Usage: ./manage.sh <command>

Commands:
  start      Start observer server in background
  stop       Stop observer server
  restart    Restart observer server
  status     Show observer server status
  logs       Show server logs (use -f for follow)
  open       Open UI in browser
  run        Run server in foreground

Environment variables:
  HOST                 Default: 127.0.0.1
  PORT                 Default: 8787
  CODEX_SESSIONS_DIR   Default: \$HOME/.codex/sessions
  CLAUDE_PROJECTS_DIR  Default: \$HOME/.claude/projects
  INDEX_FILE_EVENT_CACHE_MAX_EVENTS
                       Default: 0, retain per-file parsed event arrays only when needed
  INDEX_MAX_EVENTS
                       Default: 20000, retain only the latest indexed events; set 0 for unlimited
  INDEX_DEFAULT_WINDOW_DAYS
                       Default: 7, load the recent index window by default
  INDEX_MAX_WINDOW_DAYS
                       Default: 30, maximum switchable index window from the UI/API
  OBSERVER_NODE_MAX_OLD_SPACE_MB
                       Default: 192, cap V8 old-space to limit RSS growth
  OBSERVER_NODE_SEMI_SPACE_MB
                       Default: 8, cap V8 young generation semi-space
EOF
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is not installed or not in PATH."
    exit 1
  fi
}

find_listener_pid() {
  lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1
}

get_process_cwd() {
  local pid="${1:-}"
  if [[ -z "${pid}" ]]; then
    return 1
  fi
  lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

is_observer_pid() {
  local pid="${1:-}"
  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" 2>/dev/null; then
    return 1
  fi

  local cwd command
  cwd="$(get_process_cwd "${pid}")"
  command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"

  [[ "${cwd}" == "${ROOT_DIR}" ]] && [[ "${command}" == *"node"* ]] && [[ "${command}" == *"server.js"* ]]
}

get_running_pid() {
  local pid
  if [[ -f "${PID_FILE}" ]]; then
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if is_observer_pid "${pid}"; then
      printf '%s\n' "${pid}"
      return 0
    fi
  fi

  pid="$(find_listener_pid || true)"
  if is_observer_pid "${pid}"; then
    printf '%s\n' "${pid}" > "${PID_FILE}"
    printf '%s\n' "${pid}"
    return 0
  fi

  return 1
}

ensure_frontend_build() {
  if [[ ! -f "${ROOT_DIR}/package.json" ]]; then
    return 0
  fi

  local dist_index="${ROOT_DIR}/dist/index.html"
  local needs_build=0

  if [[ ! -f "${dist_index}" ]]; then
    needs_build=1
  elif find "${ROOT_DIR}/src" -type f -newer "${dist_index}" | grep -q .; then
    needs_build=1
  elif [[ "${ROOT_DIR}/index.html" -nt "${dist_index}" ]]; then
    needs_build=1
  fi

  if [[ "${needs_build}" -eq 1 ]]; then
    echo "Building frontend..."
    (cd "${ROOT_DIR}" && npm run build >/dev/null)
  fi
}

is_running() {
  get_running_pid >/dev/null 2>&1
}

wait_for_server() {
  local pid="${1:-}"
  local attempts elapsed
  attempts=$(( START_WAIT_SECONDS * 4 ))

  for ((elapsed=0; elapsed<attempts; elapsed+=1)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      return 1
    fi

    local listener_pid
    listener_pid="$(find_listener_pid || true)"
    if is_observer_pid "${listener_pid}"; then
      printf '%s\n' "${listener_pid}" > "${PID_FILE}"
      if command -v curl >/dev/null 2>&1; then
        if curl -fsS --max-time 1 "http://${HOST}:${PORT}/" >/dev/null 2>&1; then
          return 0
        fi
      else
        return 0
      fi
    fi

    sleep 0.25
  done

  return 1
}

start_detached_server() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${ROOT_DIR}" "${LOG_FILE}" "${HOST}" "${PORT}" "${SESSIONS_DIR}" "${CLAUDE_DIR}" "${OBSERVER_NODE_MAX_OLD_SPACE_MB}" "${OBSERVER_NODE_SEMI_SPACE_MB}" <<'PY'
import os
import subprocess
import sys

root_dir, log_file, host, port, sessions_dir, claude_dir, max_old_space_mb, semi_space_mb = sys.argv[1:]
env = os.environ.copy()
env.update({
    "HOST": host,
    "PORT": port,
    "CODEX_SESSIONS_DIR": sessions_dir,
    "CLAUDE_PROJECTS_DIR": claude_dir,
})

with open(log_file, "ab", buffering=0) as log_file_handle, open(os.devnull, "rb") as devnull:
    proc = subprocess.Popen(
        [
            "node",
            f"--max-old-space-size={max_old_space_mb}",
            f"--max-semi-space-size={semi_space_mb}",
            "--optimize-for-size",
            "--expose-gc",
            "server.js",
        ],
        cwd=root_dir,
        env=env,
        stdin=devnull,
        stdout=log_file_handle,
        stderr=log_file_handle,
        start_new_session=True,
        close_fds=True,
    )
    print(proc.pid)
PY
    return
  fi

  (
    cd "${ROOT_DIR}"
    HOST="${HOST}" PORT="${PORT}" CODEX_SESSIONS_DIR="${SESSIONS_DIR}" CLAUDE_PROJECTS_DIR="${CLAUDE_DIR}" \
      nohup node \
        --max-old-space-size="${OBSERVER_NODE_MAX_OLD_SPACE_MB}" \
        --max-semi-space-size="${OBSERVER_NODE_SEMI_SPACE_MB}" \
        --optimize-for-size \
        --expose-gc \
        server.js </dev/null >> "${LOG_FILE}" 2>&1 &
    echo $!
  )
}

start_server() {
  ensure_node
  ensure_frontend_build
  mkdir -p "${RUNTIME_DIR}"

  if is_running; then
    local pid
    pid="$(get_running_pid)"
    echo "Observer already running (PID ${pid}) at http://${HOST}:${PORT}"
    return 0
  fi

  local listener_pid
  listener_pid="$(find_listener_pid || true)"
  if [[ -n "${listener_pid}" ]]; then
    if is_observer_pid "${listener_pid}"; then
      printf '%s\n' "${listener_pid}" > "${PID_FILE}"
      echo "Observer already running (PID ${listener_pid}) at http://${HOST}:${PORT}"
      return 0
    fi
    echo "Port ${PORT} is already in use by PID ${listener_pid}."
    echo "Stop that process or run with a different PORT."
    exit 1
  fi

  : > "${LOG_FILE}"
  local pid
  pid="$(start_detached_server)"
  if [[ -z "${pid}" ]]; then
    echo "Failed to start observer: no PID returned."
    exit 1
  fi
  printf '%s\n' "${pid}" > "${PID_FILE}"

  if wait_for_server "${pid}"; then
    pid="$(get_running_pid)"
    echo "Started observer (PID ${pid})"
    echo "UI: http://${HOST}:${PORT}"
    echo "Sessions: ${SESSIONS_DIR}"
  else
    rm -f "${PID_FILE}"
    echo "Failed to start observer. Check logs:"
    echo "  ${LOG_FILE}"
    exit 1
  fi
}

stop_server() {
  local pid
  pid="$(get_running_pid || true)"

  if [[ -z "${pid}" ]]; then
    echo "Observer is not running."
    rm -f "${PID_FILE}"
    return 0
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    sleep 0.3
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
    echo "Stopped observer (PID ${pid})"
  else
    echo "Observer process not found, cleaning stale PID."
  fi
  rm -f "${PID_FILE}"
}

status_server() {
  if is_running; then
    local pid
    pid="$(get_running_pid)"
    echo "Observer is running."
    echo "PID: ${pid}"
    echo "UI: http://${HOST}:${PORT}"
    echo "Sessions: ${SESSIONS_DIR}"
  else
    echo "Observer is not running."
    echo "Use: ./manage.sh start"
  fi
}

open_ui() {
  local url="http://${HOST}:${PORT}"
  if command -v open >/dev/null 2>&1; then
    open "${url}" >/dev/null 2>&1 || true
    echo "Opened: ${url}"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${url}" >/dev/null 2>&1 || true
    echo "Opened: ${url}"
  elif command -v wslview >/dev/null 2>&1; then
    wslview "${url}" >/dev/null 2>&1 || true
    echo "Opened: ${url}"
  else
    echo "Open this URL in your browser:"
    echo "${url}"
  fi
}

run_foreground() {
  ensure_node
  ensure_frontend_build
  cd "${ROOT_DIR}"
  HOST="${HOST}" PORT="${PORT}" CODEX_SESSIONS_DIR="${SESSIONS_DIR}" CLAUDE_PROJECTS_DIR="${CLAUDE_DIR}" \
    node \
      --max-old-space-size="${OBSERVER_NODE_MAX_OLD_SPACE_MB}" \
      --max-semi-space-size="${OBSERVER_NODE_SEMI_SPACE_MB}" \
      --optimize-for-size \
      --expose-gc \
      server.js
}

cmd="${1:-}"
case "${cmd}" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  status)
    status_server
    ;;
  logs)
    mkdir -p "${RUNTIME_DIR}"
    touch "${LOG_FILE}"
    if [[ "${2:-}" == "-f" ]]; then
      tail -f "${LOG_FILE}"
    else
      tail -n 120 "${LOG_FILE}"
    fi
    ;;
  open)
    open_ui
    ;;
  run)
    run_foreground
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: ${cmd}"
    usage
    exit 1
    ;;
esac
