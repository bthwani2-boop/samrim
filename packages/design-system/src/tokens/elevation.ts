import { colorRoles } from "./colors";

export const elevation = {
  flat: {
    shadowColor: colorRoles.shadowBase,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  raised: {
    shadowColor: colorRoles.shadowBase,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  overlay: {
    shadowColor: colorRoles.shadowBase,
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  floating: {
    shadowColor: colorRoles.shadowBase,
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10
  }
} as const;

export type ElevationToken = keyof typeof elevation;
