import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import UseAnimations from "react-useanimations";
import { useInterfaceMotion } from "../interface-motion";
import { AnimatedSymbol } from "../animated-symbol";

vi.mock("../interface-motion", () => ({ useInterfaceMotion: vi.fn() }));
vi.mock("react-useanimations", () => ({ default: vi.fn(({ render }) => render({ onMouseEnter: vi.fn() }, { "aria-hidden": true })) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("uses real animation data with finite playback and does not swallow navigation clicks", () => {
  useInterfaceMotion.mockReturnValue(true);
  const onClick = vi.fn();
  const { rerender } = render(<AnimatedSymbol name="barChart" play render={(events, icon) => (
    <button {...events} onClick={onClick}><span {...icon} />Token</button>
  )} />);
  expect(UseAnimations.mock.lastCall[0]).toMatchObject({ autoplay: true, loop: false, interaction: "hover-replay" });
  expect(UseAnimations.mock.lastCall[0].animation.animationData.layers.length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Token" }));
  expect(onClick).toHaveBeenCalledOnce();
  useInterfaceMotion.mockReturnValue(false);
  rerender(<AnimatedSymbol name="barChart" play />);
  expect(UseAnimations.mock.lastCall[0]).toMatchObject({ autoplay: false, loop: false, active: false, interaction: "click-toggle" });
});
