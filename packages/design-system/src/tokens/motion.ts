export const motion = {
  duration: {
    instant: 0,
    quick: 120,
    standard: 180,
    calm: 240,
    emphasized: 320
  },
  easing: {
    standard: "ease-in-out",
    enter: "ease-out",
    exit: "ease-in",
    linear: "linear"
  },
  reducedMotionDuration: 0
} as const;

export type MotionToken = keyof typeof motion.duration;
export type MotionEasingToken = keyof typeof motion.easing;
