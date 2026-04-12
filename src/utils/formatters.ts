// Format numbers with commas
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString();
}

// Format token counts (human readable)
export function fmtTokenHuman(n: number | null | undefined): string {
  if (n == null || n === 0) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// Short ID (truncate with ellipsis)
export function shortId(id: string, max = 12): string {
  if (!id) return '';
  return id.length <= max ? id : `${id.slice(0, max)}...`;
}

// Short path (show last N segments)
export function shortPathN(p: string, n = 3): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts.length <= n ? p : `.../${parts.slice(-n).join('/')}`;
}

// Short model name
export function shortModel(model: string): string {
  if (!model) return '-';
  // Remove -plus, -latest suffixes
  return model.replace(/-(?:plus|latest|turbo)$/i, '');
}

// Format timestamp to Shanghai time
export function formatShanghaiTime(ts: string): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

// Format short time (HH:MM:SS)
export function formatShortTime(ts: string): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

// Escape HTML
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
