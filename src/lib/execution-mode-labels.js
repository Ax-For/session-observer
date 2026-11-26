const labels = { standard: "Standard", fast: "Fast", ultrafast: "Ultrafast", ultracode: "Ultracode",
  off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", unknown: "未知" };
const evidence = { configured: "配置值", selected: "已选择", recorded: "日志记录", served: "实际生效", unknown: "未记录" };
export const modeLabel = (value) => labels[value] || labels.unknown;
export const modeEvidence = (value) => evidence[value] || evidence.unknown;
