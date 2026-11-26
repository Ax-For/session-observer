import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ResponsePerformancePanel } from "../analysis/response-performance-panel";

afterEach(cleanup);

test("shows weighted speed, sample coverage and source navigation without calling log latency TTFT", () => {
  const onOpenEvent = vi.fn();
  render(<ResponsePerformancePanel onOpenEvent={onOpenEvent} performance={{
    measuredResponses: 1, unmeasuredResponses: 1, outputTokensPerSecond: 50, firstContentP50Ms: 1000, firstContentSamples: 1,
    responses: [{ eventId: "event", time: "2026-11-07T00:00:05Z", model: "test-model", outputTokens: 200,
      durationMs: 4000, firstContentMs: 1000, outputTokensPerSecond: 50 },
    { eventId: "unknown", time: "2026-11-07T00:00:06Z", model: "test-model", outputTokens: 8, reason: "unfinished" }],
  }} />);
  expect(screen.getByText("50.0")).toBeInTheDocument();
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByText(/日志间隔估算/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("响应明细"));
  fireEvent.click(screen.getByRole("button", { name: "查看响应记录 1" }));
  expect(onOpenEvent).toHaveBeenCalledWith({ eventId: "event" });
  expect(screen.getByText("尚未完成")).toBeInTheDocument();
});

test("no measurable response is unavailable, not zero speed", () => {
  render(<ResponsePerformancePanel performance={{ responses: [], measuredResponses: 0, outputTokensPerSecond: null, firstContentP50Ms: null, firstContentSamples: 0 }} />);
  expect(screen.getByText("暂无可测量的响应")).toBeInTheDocument();
  expect(screen.queryByText("0.0")).not.toBeInTheDocument();
  expect(screen.queryByText("响应明细")).not.toBeInTheDocument();
});
