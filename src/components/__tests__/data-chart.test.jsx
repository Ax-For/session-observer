import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createChart } from "../../lib/chart-runtime";
import { useInterfaceMotion } from "../interface-motion";
import { ChartPlot, DataChart } from "../data-chart";

vi.mock("../../lib/chart-runtime", () => ({ createChart: vi.fn() }));
vi.mock("../interface-motion", () => ({ useInterfaceMotion: vi.fn() }));

describe("chart lifecycle and accessible values", () => {
  let chart;
  let disconnect;
  beforeEach(() => {
    chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    createChart.mockReturnValue(chart);
    useInterfaceMotion.mockReturnValue(true);
    disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(260);
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("updates one instance and disposes it together with its resize observer", () => {
    const { rerender, unmount } = render(<ChartPlot option={{ animation: true }} label="test chart" height={260} />);
    act(() => vi.advanceTimersByTime(30));
    expect(createChart).toHaveBeenCalledTimes(1);
    rerender(<ChartPlot option={{ animation: false }} label="test chart" height={260} />);
    expect(createChart).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenLastCalledWith({ animation: false }, { replaceMerge: ["series"] });
    unmount();
    expect(chart.dispose).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  test("table mode preserves exact values, distinguishes missing prices and releases the plot", () => {
    render(<MantineProvider><DataChart kind="trend" metric="cost" label="金额趋势"
      data={[{ label: "11/06", tokens: 1234567, estimatedUsd: 0, knownTokenTotal: 0 }]} /></MantineProvider>);
    act(() => vi.advanceTimersByTime(30));
    fireEvent.click(screen.getByRole("button", { name: "查看数据明细" }));
    expect(screen.getByRole("cell", { name: "1,234,567" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "未计价" })).toBeInTheDocument();
    expect(chart.dispose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "返回图表" }));
    act(() => vi.advanceTimersByTime(30));
    expect(screen.getByRole("img", { name: "金额趋势" })).toBeInTheDocument();
    expect(createChart).toHaveBeenCalledTimes(2);
  });

  test("motion policy changes turn off chart animation without remounting", () => {
    const content = <MantineProvider><DataChart kind="activity" data={[]} label="负载图" /></MantineProvider>;
    const { rerender } = render(content);
    act(() => vi.advanceTimersByTime(30));
    expect(chart.setOption.mock.lastCall[0].animation).toBe(true);
    useInterfaceMotion.mockReturnValue(false);
    rerender(<MantineProvider><DataChart kind="activity" data={[]} label="负载图" /></MantineProvider>);
    expect(chart.setOption.mock.lastCall[0].animation).toBe(false);
    expect(createChart).toHaveBeenCalledTimes(1);
  });
});
