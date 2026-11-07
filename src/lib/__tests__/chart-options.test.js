import { describe, expect, test } from "vitest";
import { activityOptions, compositionOptions, trendOptions } from "../chart-options";

describe("ECharts data presentation", () => {
  test("activity uses aligned independent scales without inventing a minimum bar height", () => {
    const options = activityOptions([{ label: "10:00", events: 0, tokens: 0 }, { label: "11:00", events: 10, tokens: 1000000 }]);
    expect(options.grid).toHaveLength(2);
    expect(options.axisPointer.link).toEqual([{ xAxisIndex: "all" }]);
    expect(options.series[0].data).toEqual([0, 10]);
    expect(options.series[1].data).toEqual([0, 1000000]);
    expect(options.series[0].barMinHeight).toBeUndefined();
    expect(options.series[0].yAxisIndex).not.toBe(options.series[1].yAxisIndex);
  });

  test("platform stacks reconcile to recorded totals, including unattributed usage", () => {
    const options = trendOptions([{ label: "11/06", tokens: 100, platforms: [{ key: "codex", total: 40 }, { key: "claude", total: 50 }] }]);
    expect(options.series.map((series) => series.name)).toEqual(["Codex", "Claude Code", "Qwen Code", "其他 / 未归属"]);
    expect(options.series.map((series) => series.data[0])).toEqual([40, 50, 0, 10]);
    expect(options.series.every((series) => series.stack === "tokens")).toBe(true);
    expect(options.tooltip.renderMode).toBe("richText");
  });

  test("costs without pricing are gaps, not a zero-dollar claim", () => {
    const options = trendOptions([
      { label: "11/05", tokens: 20, estimatedUsd: 0, knownTokenTotal: 0 },
      { label: "11/06", tokens: 20, estimatedUsd: 0.04, knownTokenTotal: 20 },
      { label: "11/07", tokens: 0, estimatedUsd: 0, knownTokenTotal: 0 },
    ], { metric: "cost" });
    expect(options.series[0].data).toEqual([null, 0.04, 0]);
    expect(options.series[0].connectNulls).toBe(false);
  });

  test("composition excludes reasoning subsets and preserves true small slices", () => {
    const options = compositionOptions([
      { label: "输入", value: 999 }, { label: "输出", value: 1 },
      { label: "推理", value: 1, detailOnly: true },
    ], { total: 1000 });
    expect(options.series[0].data.map((row) => row.value)).toEqual([999, 1]);
    expect(options.series[0].minAngle).toBe(0);
    const empty = compositionOptions([{ label: "输出", value: 0 }], { total: 0 });
    expect(empty.series[0].data).toEqual([]);
  });

  test("motion and theme are explicit options, not tied to changing data totals", () => {
    const options = activityOptions([], { animated: false, dark: true });
    expect(options.animation).toBe(false);
    expect(options.backgroundColor).toBe("transparent");
    expect(options.textStyle.color).toBe("#b0b7c4");
  });
});
