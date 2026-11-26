import { act, cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { useDocumentVisibility, useReducedMotion } from "@mantine/hooks";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InterfaceMotionProvider, MotionSkeleton, RefreshIcon, ViewTransition } from "../interface-motion";

vi.mock("@mantine/hooks", async (importOriginal) => ({
  ...await importOriginal(),
  useDocumentVisibility: vi.fn(),
  useReducedMotion: vi.fn(),
}));

function Wrapper({ children }) {
  return <MantineProvider><InterfaceMotionProvider>{children}</InterfaceMotionProvider></MantineProvider>;
}

describe("interface motion", () => {
  beforeEach(() => {
    useDocumentVisibility.mockReturnValue("visible");
    useReducedMotion.mockReturnValue(false);
  });
  afterEach(cleanup);

  test("animates refresh only while pending and stops in hidden or reduced-motion mode", () => {
    const { container, rerender } = render(<RefreshIcon loading />, { wrapper: Wrapper });
    const glyph = () => container.querySelector(".interface-motion-icon");
    expect(glyph()).toHaveAttribute("data-motion", "rotating");
    useDocumentVisibility.mockReturnValue("hidden");
    rerender(<RefreshIcon loading />);
    expect(glyph()).toHaveAttribute("data-motion", "still");
    useDocumentVisibility.mockReturnValue("visible");
    useReducedMotion.mockReturnValue(true);
    rerender(<RefreshIcon loading />);
    expect(glyph()).toHaveAttribute("data-motion", "still");
    useReducedMotion.mockReturnValue(false);
    rerender(<RefreshIcon loading={false} />);
    expect(glyph()).toHaveAttribute("data-motion", "still");
  });

  test("skeletons respect the same motion policy", () => {
    const { container, rerender } = render(<MotionSkeleton height={8} />, { wrapper: Wrapper });
    expect(container.querySelector(".mantine-Skeleton-root")).toHaveAttribute("data-animate");
    useReducedMotion.mockReturnValue(true);
    rerender(<MotionSkeleton height={8} />);
    expect(container.querySelector(".mantine-Skeleton-root")).not.toHaveAttribute("data-animate");
  });

  test("view transitions do not remount content or discard control state", async () => {
    const view = (key) => <ViewTransition viewKey={key}><input aria-label="draft" defaultValue="saved" /></ViewTransition>;
    const { rerender } = render(view("overview"), { wrapper: Wrapper });
    const input = screen.getByRole("textbox");
    await act(async () => { rerender(view("tokens")); });
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("saved");
  });
});
