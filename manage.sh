#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"

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
EOF
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is not installed or not in PATH."
    exit 1
  fi
}

is_running() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

start_server() {
  ensure_node
  mkdir -p "${RUNTIME_DIR}"

  if is_running; then
    local pid
    pid="$(cat "${PID_FILE}")"
    echo "Observer already running (PID ${pid}) at http://${HOST}:${PORT}"
    return 0
  fi

  : > "${LOG_FILE}"
  (
    cd "${ROOT_DIR}"
    HOST="${HOST}" PORT="${PORT}" CODEX_SESSIONS_DIR="${SESSIONS_DIR}" CLAUDE_PROJECTS_DIR="${CLAUDE_DIR}" \
      nohup node server.js >> "${LOG_FILE}" 2>&1 &
    echo $! > "${PID_FILE}"
  )

  sleep 0.4
  if is_running; then
    local pid
    pid="$(cat "${PID_FILE}")"
    echo "Started observer (PID ${pid})"
    echo "UI: http://${HOST}:${PORT}"
    echo "Sessions: ${SESSIONS_DIR}"
  else
    echo "Failed to start observer. Check logs:"
    echo "  ${LOG_FILE}"
    exit 1
  fi
}

stop_server() {
  if ! [[ -f "${PID_FILE}" ]]; then
    echo "Observer is not running."
    return 0
  fi

  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
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
    pid="$(cat "${PID_FILE}")"
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
  cd "${ROOT_DIR}"
  HOST="${HOST}" PORT="${PORT}" CODEX_SESSIONS_DIR="${SESSIONS_DIR}" CLAUDE_PROJECTS_DIR="${CLAUDE_DIR}" node server.js
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
