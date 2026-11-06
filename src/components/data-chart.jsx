import { useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Table, Tooltip, useComputedColorScheme } from "@mantine/core";
import { IconChartBar, IconTable } from "@tabler/icons-react";
import { activityOptions, compositionOptions, platformValues, pricedAmount, trendOptions } from "../lib/chart-options";
import { createChart } from "../lib/chart-runtime";
import { formatNumber } from "../lib/formatters";
import { useInterfaceMotion } from "./interface-motion";

const builders = { activity: activityOptions, trend: trendOptions, composition: compositionOptions };

export function ChartPlot({ option, height, label }) {
  const node = useRef(null);
  const chart = useRef(null);
  const latest = useRef(option);

  useEffect(() => {
    latest.current = option;
    chart.current?.setOption(option, { replaceMerge: ["series"] });
  }, [option]);

  useEffect(() => {
    const element = node.current;
    let frame;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (element.clientWidth < 2 || element.clientHeight < 2) return;
        if (!chart.current) {
          chart.current = createChart(element);
          chart.current.setOption(latest.current, { replaceMerge: ["series"] });
        } else {
          chart.current.resize({ animation: { duration: 0 } });
        }
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  return <div ref={node} className="data-chart__plot" style={{ height }} role="img" aria-label={label} />;
}

function ChartDataTable({ data, kind, metric, height, label }) {
  const isCost = metric === "cost";
  const headers = kind === "activity" ? ["时间", "事件", "Token"]
    : isCost ? ["时间", "Token", "成本估算 (USD)"] : ["时间", "Codex", "Claude Code", "其他", "合计 Token"];
  return (
    <div className="data-chart__table" style={{ height }} tabIndex={0} aria-label={`${label}数据明细`}>
      <Table stickyHeader striped highlightOnHover>
        <Table.Caption>{label} · 精确数值</Table.Caption>
        <Table.Thead><Table.Tr>{headers.map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{data.map((row, index) => {
          const parts = platformValues(row);
          const amount = pricedAmount(row);
          const values = kind === "activity" ? [row.events, row.tokens]
            : isCost ? [row.tokens, amount == null ? "未计价" : `$${Number(amount).toFixed(4)}`]
              : [parts.codex, parts.claude, parts.other, row.tokens];
          return <Table.Tr key={`${row.time || row.label}-${index}`}>
            <Table.Td>{row.label}</Table.Td>
            {values.map((value, i) => <Table.Td key={i}>{typeof value === "string" ? value : formatNumber(value || 0)}</Table.Td>)}
          </Table.Tr>;
        })}</Table.Tbody>
      </Table>
    </div>
  );
}

export function DataChart({ data, kind, metric, total, label, height = 260, testId }) {
  const dark = useComputedColorScheme("light") === "dark";
  const animated = useInterfaceMotion();
  const [table, setTable] = useState(false);
  const option = useMemo(() => builders[kind](data, { dark, animated, metric, total }), [data, kind, dark, animated, metric, total]);
  const canInspect = kind !== "composition";
  return (
    <div className={`data-chart data-chart--${kind}`} data-testid={testId}>
      {canInspect ? <Tooltip label={table ? "返回图表" : "查看数据明细"}>
        <ActionIcon className="data-chart__view" variant="subtle" color="gray" size="sm"
          aria-label={table ? "返回图表" : "查看数据明细"} aria-pressed={table} onClick={() => setTable((value) => !value)}>
          {table ? <IconChartBar size={16} /> : <IconTable size={16} />}
        </ActionIcon>
      </Tooltip> : null}
      {table ? <ChartDataTable data={data} kind={kind} metric={metric} height={height} label={label} />
        : <ChartPlot option={option} height={height} label={label} />}
    </div>
  );
}
