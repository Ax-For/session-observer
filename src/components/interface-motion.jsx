import { createContext, forwardRef, useContext, useEffect } from "react";
import { Skeleton } from "@mantine/core";
import { useDocumentVisibility, useReducedMotion } from "@mantine/hooks";
import { IconRefresh } from "@tabler/icons-react";
import { LazyMotion, MotionConfig, useAnimationControls } from "motion/react";
import * as m from "motion/react-m";

const MotionEnabled = createContext(false);
const loadFeatures = () => import("../lib/motion-features").then((module) => module.default);

export function InterfaceMotionProvider({ children }) {
  const reducedMotion = useReducedMotion(undefined, { getInitialValueInEffect: false });
  const visibility = useDocumentVisibility();
  const enabled = !reducedMotion && visibility === "visible";

  return (
    <MotionEnabled.Provider value={enabled}>
      <MotionConfig reducedMotion={enabled ? "never" : "always"}>
        <LazyMotion features={loadFeatures} strict>{children}</LazyMotion>
      </MotionConfig>
    </MotionEnabled.Provider>
  );
}

export function useInterfaceMotion() {
  return useContext(MotionEnabled);
}

export function RefreshIcon({ loading = false, size = 18 }) {
  const enabled = useInterfaceMotion();
  const spinning = enabled && loading;
  return (
    <m.span
      className="interface-motion-icon"
      aria-hidden="true"
      data-motion={spinning ? "rotating" : "still"}
      initial={false}
      animate={{ rotate: spinning ? [0, 360] : 0 }}
      transition={spinning ? { duration: 1.1, repeat: Infinity, ease: "linear" } : { duration: 0 }}
    >
      <IconRefresh size={size} stroke={1.8} />
    </m.span>
  );
}

// Animate the existing surface without remounting filters or open details.
export const ViewTransition = forwardRef(function ViewTransition({ viewKey, ...props }, ref) {
  const enabled = useInterfaceMotion();
  const controls = useAnimationControls();
  useEffect(() => {
    if (enabled) {
      void controls.start({ opacity: [0.65, 1], transition: { duration: 0.18, ease: "easeOut" } });
    } else {
      controls.set({ opacity: 1 });
    }
    return () => controls.stop();
  }, [controls, enabled, viewKey]);
  return <m.div {...props} ref={ref} initial={false} animate={controls} />;
});

export function MotionSkeleton(props) {
  const enabled = useInterfaceMotion();
  return <Skeleton {...props} animate={enabled} />;
}
