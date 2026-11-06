import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SessionAnalysisPanel, StatisticsAudit } from "./analysis-panels";
import { BookmarkButton, LibraryProvider } from "./library-context";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: {
  fetchSessionAnalysis: vi.fn(), fetchAudit: vi.fn(), fetchPricebook: vi.fn(), fetchLibrary: vi.fn(), saveLibrary: vi.fn(),
} }));

const mount = (element) => render(<MantineProvider>{element}</MantineProvider>);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test("turn analysis distinguishes unpriced tokens and unavailable timing, with source navigation", async () => {
  apiClient.fetchSessionAnalysis.mockResolvedValue({ events: 12, hasEarlierEvents: true, turns: [
    { id: "event-a", title: "分析记录", time: "2026-09-12T00:00:00Z", tokens: 500, cost: 0, unpricedTokens: 500, tools: 2, pairedTools: 0, toolTimeMs: 0 },
  ] });
  const open = vi.fn();
  mount(<SessionAnalysisPanel sessionId="s" revision="1" view="usage" onOpenEvent={open} />);
  expect(screen.getByRole("status")).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: "分析记录" }));
  expect(open).toHaveBeenCalledWith({ eventId: "event-a" });
  expect(screen.getByText("500 未计价")).toBeVisible();
  expect(screen.getByText("未知")).toBeVisible();
});

test("changing sessions aborts the previous analysis and errors can be retried", async () => {
  let signal;
  apiClient.fetchSessionAnalysis.mockImplementationOnce((_id, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }).mockRejectedValue(new Error("fixture failed"));
  const ui = mount(<SessionAnalysisPanel sessionId="a" revision="1" view="usage" />);
  ui.rerender(<MantineProvider><SessionAnalysisPanel sessionId="b" revision="1" view="usage" /></MantineProvider>);
  expect(signal.aborted).toBe(true);
  expect(await screen.findByRole("alert")).toHaveTextContent("fixture failed");
  apiClient.fetchSessionAnalysis.mockResolvedValue({ events: 0, turns: [] });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("live revisions coalesce without aborting analysis or clearing the previous table", async () => {
  let resolveFirst;
  let resolveNext;
  let signal;
  const payload = { events: 10, turns: [] };
  apiClient.fetchSessionAnalysis.mockImplementationOnce((_id, options) => {
    signal = options.signal;
    return new Promise((resolve) => { resolveFirst = resolve; });
  }).mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; }));
  const ui = mount(<SessionAnalysisPanel sessionId="s" revision="1" view="usage" />);
  ui.rerender(<MantineProvider><SessionAnalysisPanel sessionId="s" revision="2" view="usage" /></MantineProvider>);
  ui.rerender(<MantineProvider><SessionAnalysisPanel sessionId="s" revision="3" view="usage" /></MantineProvider>);
  expect(signal.aborted).toBe(false);
  expect(apiClient.fetchSessionAnalysis).toHaveBeenCalledTimes(1);
  await act(async () => resolveFirst(payload));
  expect(apiClient.fetchSessionAnalysis).toHaveBeenCalledTimes(2);
  expect(screen.getByText("轮次成本与工具耗时")).toBeVisible();
  expect(screen.getByRole("status")).toBeVisible();
  await act(async () => resolveNext({ ...payload, events: 12 }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText(/最近 12 条事件/)).toBeVisible();
});

test("audit remains lazy until its disclosure opens", async () => {
  apiClient.fetchAudit.mockResolvedValue({ runs: [] });
  apiClient.fetchPricebook.mockResolvedValue({ rates: [] });
  mount(<StatisticsAudit summary={{}} revision="1" />);
  expect(apiClient.fetchAudit).not.toHaveBeenCalled();
  const details = screen.getByText("统计审计与历史价格").parentElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(apiClient.fetchAudit).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("自定义历史价格")).toBeVisible();
});

test("message bookmarks toggle stored references without full conversation payloads", async () => {
  apiClient.fetchLibrary.mockResolvedValue({ views: [], bookmarks: [] });
  apiClient.saveLibrary.mockResolvedValue({ views: [], bookmarks: [{ id: "b", eventId: "e", sessionId: "s" }] });
  mount(<LibraryProvider><BookmarkButton entry={{ eventId: "e", sessionId: "s", content: "x".repeat(1000) }} /></LibraryProvider>);
  await waitFor(() => expect(apiClient.fetchLibrary).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "保存消息书签" }));
  expect(await screen.findByRole("button", { name: "取消消息书签" })).toBeVisible();
  expect(apiClient.saveLibrary.mock.calls[0][1].label).toHaveLength(80);
  expect(apiClient.saveLibrary.mock.calls[0][1]).not.toHaveProperty("content");
});
