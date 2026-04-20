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

    throw new Error(`Unexpected fetch: ${url}`);
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

  test("clears the focused session from URL when returning to the global stream", async () => {
    window.history.replaceState(null, "", "/?session=sess-42");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "返回全部会话" }));

    await waitFor(() => {
      expect(window.location.search).not.toContain("session=sess-42");
    });
  });
});
