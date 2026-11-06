import { formatHumanNumber, formatNumber } from "./formatters";

export const CHART_COLORS = {
  input: "#3275e5", cacheRead: "#24a879", cacheWrite: "#23a6b7",
  output: "#8b70d7", reasoning: "#b68138",
  codex: "#4774ce", claude: "#ad7954", other: "#a1a9b5",
};

const number = (value) => Math.max(0, Number(value) || 0);
const usd = (value) => `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}`;

export function pricedAmount(row) {
  return row.tokens > 0 && !(row.knownTokenTotal > 0) && !(row.estimatedUsd > 0)
    ? null : number(row.estimatedUsd);
}

export function platformValues(row) {
  const entries = row.platforms || [];
  const codex = entries.filter((entry) => entry.key === "codex").reduce((sum, entry) => sum + number(entry.total), 0);
  const claude = entries.filter((entry) => entry.key === "claude").reduce((sum, entry) => sum + number(entry.total), 0);
  return { codex, claude, other: Math.max(0, number(row.tokens) - codex - claude) };
}

function palette(dark) {
  return dark
    ? { text: "#b0b7c4", heading: "#f0f2f5", line: "#303743", panel: "#222831" }
    : { text: "#667181", heading: "#202733", line: "#e8ecf1", panel: "#ffffff" };
}

function base({ dark = false, animated = false } = {}) {
  const colors = palette(dark);
  return {
    backgroundColor: "transparent",
    animation: animated,
    animationDuration: 420,
    animationDurationUpdate: 220,
    textStyle: { color: colors.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 11 },
    aria: { enabled: false },
    tooltip: {
      trigger: "axis", renderMode: "richText", confine: true,
      backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1,
      padding: [10, 12], textStyle: { color: colors.heading, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: colors.text, type: "dashed", opacity: 0.45 } },
      valueFormatter: (value) => value == null ? "未计价" : formatNumber(value),
    },
  };
}

function valueAxis(name, dark, formatter = formatHumanNumber) {
  const colors = palette(dark);
  return {
    type: "value", name, min: 0, splitNumber: 2, nameGap: 12,
    nameTextStyle: { color: colors.text, align: "right", padding: [0, 5, 0, 0] },
    axisLabel: { color: colors.text, formatter, fontSize: 11 },
    axisLine: { show: false }, axisTick: { show: false },
    splitLine: { lineStyle: { color: colors.line, type: "dashed" } },
  };
}

function timeAxis(data, dark) {
  return {
    type: "category", data: data.map((row) => row.label || "-"),
    axisTick: { show: false }, axisLine: { show: false },
    axisLabel: { color: palette(dark).text, fontSize: 11, hideOverlap: true, margin: 12 },
    axisPointer: { label: { show: false } },
  };
}

export function activityOptions(data, settings = {}) {
  return {
    ...base(settings),
    grid: [
      { left: 60, right: 12, top: 25, height: "30%" },
      { left: 60, right: 12, top: "59%", bottom: 28 },
    ],
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis: [
      { ...timeAxis(data, settings.dark), gridIndex: 0, axisLabel: { show: false } },
      { ...timeAxis(data, settings.dark), gridIndex: 1 },
    ],
    yAxis: [
      { ...valueAxis("事件", settings.dark), gridIndex: 0, minInterval: 1 },
      { ...valueAxis("Token", settings.dark), gridIndex: 1 },
    ],
    series: [
      {
        name: "事件", type: "bar", xAxisIndex: 0, yAxisIndex: 0,
        data: data.map((row) => number(row.events)), barMaxWidth: 18,
        itemStyle: { color: CHART_COLORS.codex, borderRadius: [3, 3, 0, 0] },
        emphasis: { itemStyle: { color: "#1757c2" } },
      },
      {
        name: "Token", type: "line", xAxisIndex: 1, yAxisIndex: 1,
        data: data.map((row) => number(row.tokens)), smooth: false,
        showSymbol: false, symbolSize: 6,
        itemStyle: { color: CHART_COLORS.cacheRead }, lineStyle: { width: 2 },
        areaStyle: { color: CHART_COLORS.cacheRead, opacity: 0.1 },
      },
    ],
  };
}

export function trendOptions(data, settings = {}) {
  const isCost = settings.metric === "cost";
  const points = data.map(platformValues);
  const platformSeries = [
    { key: "codex", name: "Codex" }, { key: "claude", name: "Claude Code" },
    ...(points.some((row) => row.other > 0) ? [{ key: "other", name: "其他 / 未归属" }] : []),
  ];
  return {
    ...base(settings),
    grid: { left: 64, right: 12, top: 42, bottom: 30 },
    legend: {
      show: !isCost, top: 0, left: 58, itemWidth: 8, itemHeight: 8, icon: "circle",
      itemGap: 20, textStyle: { color: palette(settings.dark).text, fontSize: 11 },
    },
    xAxis: timeAxis(data, settings.dark),
    yAxis: { ...valueAxis("", settings.dark, isCost ? usd : formatHumanNumber), splitNumber: 4 },
    tooltip: { ...base(settings).tooltip, valueFormatter: isCost ? (value) => value == null ? "未计价" : usd(value) : formatNumber },
    series: isCost ? [{
      id: "cost", name: "成本估算", type: "line", data: data.map(pricedAmount),
      connectNulls: false, smooth: false, symbol: "circle", symbolSize: 5,
      itemStyle: { color: CHART_COLORS.cacheRead }, lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
    }] : platformSeries.map(({ key, name }) => ({
      id: key, name, type: "bar", stack: "tokens", data: points.map((row) => row[key]),
      barMaxWidth: 30, itemStyle: { color: CHART_COLORS[key] },
      emphasis: { focus: "series" },
    })),
  };
}

export function compositionOptions(rows, settings = {}) {
  const common = base(settings);
  return {
    ...common,
    title: {
      text: formatHumanNumber(settings.total || 0), subtext: "有效 Token", left: "center", top: "37%",
      itemGap: 8,
      textStyle: { color: palette(settings.dark).heading, fontSize: 23, fontWeight: 600 },
      subtextStyle: { color: palette(settings.dark).text, fontSize: 11 },
    },
    tooltip: { ...common.tooltip, trigger: "item" },
    series: [{
      type: "pie", radius: ["69%", "86%"], center: ["50%", "50%"], minAngle: 0,
      stillShowZeroSum: false, label: { show: false }, labelLine: { show: false },
      emptyCircleStyle: { color: palette(settings.dark).line },
      emphasis: { scaleSize: 4 },
      data: rows.filter((row) => !row.detailOnly && row.value > 0).map((row) => ({
        name: row.label, value: row.value, itemStyle: { color: CHART_COLORS[row.key] || row.color },
      })),
    }],
  };
}
