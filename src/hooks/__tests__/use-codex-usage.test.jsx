import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiClient } from "../../api/client";
import { useCodexUsage } from "../use-codex-usage";

function Probe({ enabled = true }) {
  const { codexUsagePayload, queryCodexUsage } = useCodexUsage({ enabled });
  return (
    <div>
      <output>{codexUsagePayload.status}:{codexUsagePayload.updatedAt || "-"}</output>
      <span>{codexUsagePayload.error}</span>
      <button type="button" onClick={queryCodexUsage}>查询</button>
    </div>
  );
}

describe("useCodexUsage", () => {
  beforeEach(() => {
    vi.spyOn(apiClient, "fetchCodexUsage").mockResolvedValue({
      status: "ready",
      installed: true,
      updatedAt: "2026-07-11T13:15:00.000Z",
      limits: [],
    });
    vi.spyOn(apiClient, "refreshCodexUsage").mockResolvedValue({
      status: "ready",
      installed: true,
      updatedAt: "2026-07-11T13:20:00.000Z",
      limits: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("restores the local snapshot without querying Codex until explicitly requested", async () => {
    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByText("ready:2026-07-11T13:15:00.000Z")).toBeInTheDocument();
    });
    expect(apiClient.fetchCodexUsage).toHaveBeenCalledTimes(1);
    expect(apiClient.refreshCodexUsage).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "查询" }));
    });
    expect(apiClient.refreshCodexUsage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("ready:2026-07-11T13:20:00.000Z")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "查询" }));
    });
    expect(apiClient.refreshCodexUsage).toHaveBeenCalledTimes(2);
  });

  test("does not request account usage while disabled", async () => {
    render(<Probe enabled={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "查询" }));
    });
    expect(apiClient.fetchCodexUsage).not.toHaveBeenCalled();
    expect(apiClient.refreshCodexUsage).not.toHaveBeenCalled();
  });

  test("keeps cached quota after a network failure and clears the warning on retry", async () => {
    apiClient.refreshCodexUsage.mockRejectedValueOnce(new Error("Network error"));
    render(<Probe />);
    await screen.findByText("ready:2026-07-11T13:15:00.000Z");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查询" })));
    expect(screen.getByText("ready:2026-07-11T13:15:00.000Z")).toBeInTheDocument();
    expect(screen.getByText(/更新失败.*上次结果/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "查询" })));
    expect(screen.getByText("ready:2026-07-11T13:20:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText(/更新失败/)).not.toBeInTheDocument();
  });
});
