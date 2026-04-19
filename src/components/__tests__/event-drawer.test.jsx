import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EventDrawer } from "../event-drawer";

describe("EventDrawer", () => {
  test("renders highlighted json and exposes session id copy action", () => {
    const onCopyJson = vi.fn();
    const onCopySessionId = vi.fn();

    render(
      <MantineProvider>
        <EventDrawer
          opened
          onClose={() => {}}
          onCopy={onCopyJson}
          onCopySessionId={onCopySessionId}
          event={{
            sourceType: "codex",
            callType: "Tool_Call",
            model: "gpt-5.4",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            sessionTitle: "优化session-observer",
            time: "2026-04-19T18:28:36.000Z",
            cwd: "/Users/me/code/session-observer",
            extra: "tool=exec_command",
            nested: { ok: true, retries: 2 },
          }}
        />
      </MantineProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "事件详情" });
    expect(dialog.querySelector(".json-token--key")).toHaveTextContent("\"sourceType\"");
    expect(dialog.querySelector(".json-token--string")).toHaveTextContent("\"codex\"");

    fireEvent.click(within(dialog).getByRole("button", { name: /复制会话 id/i }));
    expect(onCopySessionId).toHaveBeenCalledWith("019da544-e133-7b71-9e63-79d2bbba8713");
  });
});
