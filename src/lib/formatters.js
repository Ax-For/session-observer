const zhNumber = new Intl.NumberFormat("zh-CN");

export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return zhNumber.format(num);
}

export function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return zhNumber.format(num);
}

export function formatHumanNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  if (Math.abs(num) >= 1_0000_0000) return `${(num / 1_0000_0000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}亿`;
  if (Math.abs(num) >= 1_0000) return `${(num / 1_0000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}万`;
  return zhNumber.format(num);
}

export function formatBytes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = Math.abs(num);
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const signed = num < 0 ? -current : current;
  return `${signed.toFixed(unitIndex === 0 ? 0 : 1).replace(/\.0$/, "")} ${units[unitIndex]}`;
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatFullDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function platformLabel(value) {
  if (value === "codex") return "Codex";
  if (value === "claude") return "Claude Code";
  return "Unknown";
}

export function callTypeLabel(value) {
  return String(value || "Unknown").replace(/_/g, " ");
}

export function shortSessionId(value) {
  const text = String(value || "");
  return text ? text.slice(0, 8) : "-";
}

export function clipText(value, max = 120) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function downloadJson(filename, data, space = 2) {
  const blob = new Blob([JSON.stringify(data, null, space)], { type: "application/json;charset=utf-8" });
  triggerDownload(filename, blob);
}

export function downloadJsonl(filename, records) {
  const lines = (records || []).map((record) => JSON.stringify(record));
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "application/x-ndjson;charset=utf-8" });
  triggerDownload(filename, blob);
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
