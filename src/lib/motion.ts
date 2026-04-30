import type { Transition } from "motion/react";

export const REDUCED_MOTION_TRANSITION: Transition = {
  duration: 0,
  delay: 0,
};

export function motionProps(
  reduced: boolean,
  props: {
    initial?: Record<string, unknown>;
    animate?: Record<string, unknown>;
    exit?: Record<string, unknown>;
    transition?: Transition;
  }
) {
  if (reduced) {
    return {
      initial: props.animate,
      animate: props.animate,
      exit: props.exit ? props.animate : undefined,
      transition: REDUCED_MOTION_TRANSITION,
    };
  }
  return props;
}
