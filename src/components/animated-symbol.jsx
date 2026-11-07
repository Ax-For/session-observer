import UseAnimations from "react-useanimations";
import activity from "react-useanimations/lib/activity";
import barChart from "react-useanimations/lib/barChart";
import cpu from "react-useanimations/lib/cpu";
import database from "react-useanimations/lib/database";
import users from "react-useanimations/lib/users";
import messageCircle from "react-useanimations/lib/messageCircle";
import list from "react-useanimations/lib/list";
import clock from "react-useanimations/lib/clock";
import terminal from "react-useanimations/lib/terminal";
import { useInterfaceMotion } from "./interface-motion";

const symbols = { activity, barChart, cpu, database, users, messageCircle, list, clock, terminal };

export function AnimatedSymbol({ name, size = 24, play = false, render }) {
  const enabled = useInterfaceMotion();
  return (
    <UseAnimations
      animation={symbols[name] || activity}
      size={size}
      strokeColor="currentColor"
      interaction={enabled ? "hover-replay" : "click-toggle"}
      autoplay={enabled && play}
      loop={false}
      active={false}
      render={(events, animation) => render
        ? render(events, { ...animation, "data-animated-symbol": name, className: "animated-symbol" })
        : <span {...events} {...animation} data-animated-symbol={name} className="animated-symbol" />}
    />
  );
}
