import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { LiveSpeedView, liveSpeedOptions } from "../live-speed-panel";
vi.mock("../data-chart", () => ({ ChartPlot: ({ label }) => <div role="img" aria-label={label} /> }));
afterEach(cleanup);
const data = { measured: 10, estimated: 20, generating: 1, tools: 0, unknown: 0, history: [{ time: 10000, measured: 10, estimated: 20 }],
  sources: [{ sourceType: "codex", measured: 10, estimated: 20 }], monitor: { trackedFiles: 2 },
  agents: [{ id: "a", sessionId: "a", title: "会话 A", project: "项目 A", sourceType: "codex", model: "test", phase: "generating", measured: 10, estimated: 20 },
    { id: "b", sessionId: "b", title: "会话 B", project: "项目 B", sourceType: "claude", model: "test", phase: "idle", measured: 0, estimated: 0 }] };
test("shows live components and phases, reveals idle sessions and opens the selected session", () => {
  const open = vi.fn();
  render(<MantineProvider><LiveSpeedView data={data} status="connected" onOpenSessionDetail={open} /></MantineProvider>);
  expect(screen.getByTestId("live-speed-total")).toHaveTextContent("30.0");
  expect(screen.getByText("实测 10.0 · 估算 20.0")).toBeInTheDocument();
  expect(screen.queryByText("会话 B")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("显示空闲")); expect(screen.getByText("会话 B")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看会话 会话 A" })); expect(open).toHaveBeenCalledWith(data.agents[0]);
});
test("missing samples and disconnected snapshots never display a false current zero", () => {
  const { rerender } = render(<MantineProvider><LiveSpeedView data={{ ...data, measured: 0, estimated: 0, unknown: 1 }} status="connected" /></MantineProvider>);
  expect(screen.getByTestId("live-speed-total")).toHaveTextContent("—");
  expect(screen.getByText("等待可测量的响应")).toBeInTheDocument();
  rerender(<MantineProvider><LiveSpeedView data={data} status="reconnecting" /></MantineProvider>);
  expect(screen.getByTestId("live-speed-total")).toHaveTextContent("—");
  expect(screen.getByRole("status")).toHaveTextContent("连接中断");
});
test("history preserves exact measured and estimated series in a nonanimated chart", () => {
  const option = liveSpeedOptions(data.history);
  expect(option.series.map((s) => s.data)).toEqual([[10], [20]]);
  expect(option.animation).toBe(false);
});
