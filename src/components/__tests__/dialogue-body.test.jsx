import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { apiClient } from "../../api/client";
import { ConversationEntry } from "../conversation-drawer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test("dialogue body loads bounded pages on demand without retaining previous full pages", async () => {
  const request = vi.spyOn(apiClient, "fetchDialogueBody").mockResolvedValueOnce({ content: "完整回答第一段", offset: 0, nextOffset: 65536, totalLength: 70000, hasMore: true })
    .mockResolvedValueOnce({ content: "回答的最后一段", offset: 65536, nextOffset: 70000, totalLength: 70000, hasMore: false });
  const detail = vi.spyOn(apiClient, "fetchEventDetail");
  render(<MantineProvider><ConversationEntry entry={{ eventId: "a", role: "agent", kind: "message", content: "预览", contentTruncated: true }} /></MantineProvider>);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "读取完整正文" }));
  await screen.findByText("完整回答第一段");
  fireEvent.click(screen.getByRole("button", { name: "下一段" }));
  await screen.findByText("回答的最后一段");
  expect(screen.queryByText("完整回答第一段")).toBeNull();
  expect(detail).not.toHaveBeenCalled();
  await waitFor(() => expect(request).toHaveBeenLastCalledWith("a", { offset: 65536, limit: 65536 }, expect.any(Object)));
});
