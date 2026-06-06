import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../app";

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function mockFetch() {
  return vi.fn(async (input) => {
    const url = String(input);

    if (url.startsWith("/api/events")) {
      return jsonResponse({
        events: [],
        sessions: [
          {
            sessionId: "sess-42",
            sessionTitle: "rename flow",
            fallbackTitle: "rename flow",
            sourceType: "claude",
            latest: "2026-04-20T00:00:00.000Z",
            count: 24,
            cwd: "/Users/me/code/session-observer",
            aggregateToken: {
              input: 3200,
              output: 420,
              total: 3620,
              cachedInput: 1200,
              reasoningOutput: 0,
            },
            models: ["gpt-5.4"],
          },
        ],
        meta: {
          models: ["gpt-5.4"],
          types: ["Tool_Call"],
          platforms: ["codex", "claude"],
        },
        totalVisible: 0,
        totalMatching: 0,
        page: { offset: 0, limit: 250, hasMore: false },
        generatedAt: "2026-04-20T00:00:00.000Z",
        codexVersion: "0.1.0",
        claudeVersion: "1.0.0",
      });
    }

    if (url.startsWith("/api/sessions")) {
      return jsonResponse({
        groups: {},
        total: 0,
        generatedAt: "2026-04-20T00:00:00.000Z",
      });
    }

    if (url.startsWith("/api/observability")) {
      return jsonResponse({
        generatedAt: "2026-04-20T00:00:00.000Z",
        summary: {
          health: { eventsTotal: 0, sessionsTotal: 0, alertEvents: 0 },
          tokens: {
            effectiveTotal: 0,
            windows: { day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } },
          },
          alerts: { total: 0, recent: [], byType: [], byPlatform: [] },
          tools: { totalCalls: 0, totalResults: 0, topTools: [] },
          workspaces: { topWorkspaces: [] },
        },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function fetchedUrls() {
  return fetch.mock.calls.map(([input]) => String(input));
}

function waitForStartupTimers() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 220);
  });
}

describe("App URL state", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  test("hydrates the current interface from URL search params", async () => {
    window.history.replaceState(
      null,
      "",
      "/?tab=sessions&q=observer&model=gpt-5.4&type=Tool_Call&platform=claude&qf=alert&mode=raw&sort=asc&from=2026-04-19T10:00&to=2026-04-19T11:00&tt=35000&sq=rename&sp=claude&named=1&session=sess-42",
    );

    render(<App />);

    expect(await screen.findByDisplayValue("rename")).toBeInTheDocument();
    expect(screen.getByLabelText("仅显示已命名")).toBeChecked();
    expect(screen.getByDisplayValue("Claude Code")).toBeInTheDocument();
  });

  test("writes key workspace state back into the URL", async () => {
    render(<App />);

    const searchInput = await screen.findByPlaceholderText("内容 / session / tool / cwd");
    fireEvent.change(searchInput, { target: { value: "incident" } });
    fireEvent.click(screen.getByRole("radio", { name: "原始" }));
    fireEvent.click(screen.getByRole("radio", { name: "异常" }));
    fireEvent.click(screen.getByRole("radio", { name: "会话" }));

    await waitFor(() => {
      expect(window.location.search).toContain("tab=sessions");
      expect(window.location.search).toContain("q=incident");
      expect(window.location.search).toContain("mode=raw");
      expect(window.location.search).toContain("qf=alert");
    });
  });

  test("clears the focused session from the sessions page", async () => {
    window.history.replaceState(null, "", "/?tab=sessions&session=sess-42");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "取消聚焦会话 sess-42" }));

    await waitFor(() => {
      expect(window.location.search).not.toContain("session=sess-42");
    });
  });

  test("hydrates observability tabs from URL state", async () => {
    window.history.replaceState(null, "", "/?tab=tokens");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Token 消耗" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Token" })).toBeChecked();
    await waitFor(() => {
      expect(window.location.search).toContain("tab=tokens");
    });
  });

  test("loads only observability data when refreshing directly into overview", async () => {
    window.history.replaceState(null, "", "/?tab=overview");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "运行总览" })).toBeInTheDocument();
    await waitForStartupTimers();

    expect(fetchedUrls()).toEqual(["/api/observability"]);
  });

  test("loads only session data when refreshing directly into sessions", async () => {
    window.history.replaceState(null, "", "/?tab=sessions");

    render(<App />);

    expect(await screen.findByText("搜索会话")).toBeInTheDocument();
    await waitForStartupTimers();

    expect(fetchedUrls()).toEqual(["/api/sessions"]);
  });

  test("maps the retired alert queue URL to activity insights", async () => {
    window.history.replaceState(null, "", "/?tab=alerts");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "活动洞察" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "洞察" })).toBeChecked();
    await waitFor(() => {
      expect(window.location.search).toContain("tab=insights");
    });
  });

  test("does not trigger global shortcuts while typing in search inputs", async () => {
    render(<App />);

    const searchInput = await screen.findByPlaceholderText("内容 / session / tool / cwd");
    searchInput.focus();

    expect(screen.getByRole("radio", { name: "观测" })).toBeChecked();
    const fetchCountBeforeTyping = fetch.mock.calls.length;

    fireEvent.keyDown(searchInput, { key: "m" });
    fireEvent.keyDown(searchInput, { key: "t" });
    fireEvent.keyDown(searchInput, { key: "r" });
    fireEvent.keyDown(searchInput, { key: "a" });

    expect(screen.getByRole("radio", { name: "观测" })).toBeChecked();
    expect(fetch).toHaveBeenCalledTimes(fetchCountBeforeTyping);

    const slashEvent = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });
    searchInput.dispatchEvent(slashEvent);

    expect(slashEvent.defaultPrevented).toBe(false);
  });

  test("clears the focused session from URL when returning to the global stream", async () => {
    window.history.replaceState(null, "", "/?session=sess-42");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "返回全部会话" }));

    await waitFor(() => {
      expect(window.location.search).not.toContain("session=sess-42");
    });
  });
});
