import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SessionWorkspace } from "../session-workspace";

describe("SessionWorkspace", () => {
  test("keeps a session id copy action on session cards", () => {
    const onCopySessionId = vi.fn();

    render(
      <MantineProvider>
        <SessionWorkspace
          sections={[
            {
              cwd: "/Users/me/code/session-observer",
              total: 1,
              sessions: [
                {
                  sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
                  sourceType: "codex",
                  title: "优化session-observer",
                  latest: "2026-04-19T18:28:36.000Z",
                  count: 6552,
                  totalTokens: 132100000,
                  cwd: "/Users/me/code/session-observer",
                  models: ["gpt-5.4"],
                },
              ],
            },
          ]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={onCopySessionId}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /复制会话 id · 019da544/i }));
    expect(onCopySessionId).toHaveBeenCalledWith("019da544-e133-7b71-9e63-79d2bbba8713");
  });
});
