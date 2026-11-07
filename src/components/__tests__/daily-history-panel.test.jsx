import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { DailyHistoryPanel } from "../daily-history-panel";
import { useDailyHistory } from "../../hooks/use-daily-history";

vi.mock("../../hooks/use-daily-history", () => ({ useDailyHistory: vi.fn() }));
vi.mock("../data-chart", () => ({ ChartPlot: ({ label }) => <div role="img" aria-label={label} /> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const counts = { requests: 5, input: 1200, cachedInput: 800, output: 200, measured: 4, outputTokS: 50, pricedRequests: 0, unfinalized: 1 };
const payload = { today: "2026-11-07", range: { from: "2026-11-01", to: "2026-11-07", source: "", model: "" },
  scan: { status: "ready", generatedAt: 1, coverage: {} }, available: { first: "2026-01-01" },
  totals: counts, models: ["example-model"], days: [{ day: "2026-11-04", ...counts }], offset: 0, totalDays: 1, pageSize: 30,
  modes: [{ kind: "tier", value: "fast", evidence: "selected", requests: 5, outputTokS: 50 }],
};
function show(state = {}) {
  const hook = { data: payload, status: { status: "ready" }, loading: false, refreshing: false,
    refresh: vi.fn(), retry: vi.fn(), ...state };
  vi.mocked(useDailyHistory).mockReturnValue(hook);
  render(<MantineProvider><DailyHistoryPanel /></MantineProvider>);
  return hook;
}

test("history applies draft filters explicitly and disables export until they are applied", () => {
  show();
  expect(screen.getByRole("table", { name: "每日用量明细" })).toHaveTextContent("1,200");
  expect(screen.getByRole("button", { name: "导出 CSV", exact: true })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "来源", exact: true }), { target: { value: "codex" } });
  expect(screen.getByRole("button", { name: "导出 CSV", exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
  expect(useDailyHistory).toHaveBeenLastCalledWith({ from: "2026-11-01", to: "2026-11-07", source: "codex", model: "", offset: 0 });
});

test("unmeasured speed and unpriced costs remain unavailable while mode evidence is explicit", () => {
  show({ data: { ...payload, totals: { ...counts, outputTokS: null }, days: [{ day: "2026-11-04", ...counts, outputTokS: null }] } });
  const table = screen.getByRole("table", { name: "每日用量明细" });
  expect(table).toHaveTextContent("—");
  expect(screen.getByText("1 次未结束")).toBeInTheDocument();
  fireEvent.click(screen.getByText("执行档位与推理强度", { exact: true }));
  expect(screen.getByRole("table", { name: "执行档位" })).toHaveTextContent("Fast已选择");
});

test("initial backfill does not claim an empty history and failed reads offer a retry", () => {
  const hook = show({ data: { ...payload, scan: null, totals: { requests: 0 } }, status: { status: "loading", progress: { completed: 1, total: 3 } } });
  expect(screen.getByText("正在读取每日汇总")).toBeInTheDocument();
  expect(screen.queryByText("此范围暂无记录")).not.toBeInTheDocument();
  cleanup();
  show({ requestError: "network", retry: hook.retry });
  fireEvent.click(screen.getByRole("button", { name: "重试", exact: true }));
  expect(hook.retry).toHaveBeenCalledOnce();
});
