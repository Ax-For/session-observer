import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { PerformanceScorePanel } from "../performance-score-panel";
vi.mock("../data-chart", () => ({ ChartPlot: ({ label }) => <div role="img" aria-label={label} /> }));
afterEach(cleanup);
const perf = { shown: 1200, score: 1200, n: 5, model: "fixture", provisional: true, form: "live", components: [{ id: "T", present: true, measure: 50, samples: 5, subScore: 1000 }, { id: "L", present: false, samples: 2 }] };
const live = { performance: { agentId: "a" }, performanceBaseline: { today: "2026-11-07" }, agents: [{ id: "a", title: "测试会话", sourceType: "codex", performance: perf }] };
const baseline = { status: "ready", today: "2026-11-07", generatedAt: 1, models: [{ sourceType: "codex", model: "fixture", score: 1000, n: 30, days: 2, trend: [] }] };
test("shows the current score, pooled baseline, deviation and component coverage", () => {
  const refresh = vi.fn();
  render(<MantineProvider><PerformanceScorePanel live={live} baseline={baseline} fresh onRefresh={refresh} /></MantineProvider>);
  expect(screen.getByTestId("performance-current")).toHaveTextContent("1,200");
  expect(screen.getByTestId("performance-baseline")).toHaveTextContent("1,000");
  expect(screen.getByTestId("performance-comparison")).toHaveTextContent("+20%");
  expect(screen.getByText("5 次有效响应 · 暂定评分")).toBeInTheDocument();
  fireEvent.click(screen.getByText("查看 7 项指标与历史基线"));
  expect(screen.getByText("50 tok/s")).toBeInTheDocument(); expect(screen.getByText("样本不足")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "更新基线" })); expect(refresh).toHaveBeenCalledOnce();
});
test("a stale day, missing baseline or disconnected stream never creates a comparison", () => {
  const { rerender } = render(<MantineProvider><PerformanceScorePanel live={live} baseline={{ ...baseline, today: "2026-11-06" }} fresh /></MantineProvider>);
  expect(screen.getByTestId("performance-comparison")).toHaveTextContent("—");
  expect(screen.getByTestId("performance-baseline")).toHaveTextContent("—");
  rerender(<MantineProvider><PerformanceScorePanel live={live} baseline={baseline} fresh={false} /></MantineProvider>);
  expect(screen.getByTestId("performance-current")).toHaveTextContent("—");
  expect(screen.getByTestId("performance-comparison")).toHaveTextContent("—");
});
test("empty samples and failed scans provide explicit states and a retry action", () => {
  render(<MantineProvider><PerformanceScorePanel live={{ agents: [] }} baseline={{ status: "error", error: "扫描失败", models: [] }} onRefresh={() => {}} fresh /></MantineProvider>);
  expect(screen.getByText("样本不足 · 0 / 3 次有效响应")).toBeInTheDocument();
  fireEvent.click(screen.getByText("查看 7 项指标与历史基线"));
  expect(screen.getByRole("alert")).toHaveTextContent("扫描失败");
  expect(screen.getByRole("button", { name: "重试更新" })).toBeEnabled();
});
