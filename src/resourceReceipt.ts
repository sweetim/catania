import { emptyResources, RESOURCES } from "./game/engine";
import type { Resources } from "./game/types";

export function getResourceGains(previous: Resources, next: Resources): Resources {
  const gains = emptyResources();
  for (const resource of RESOURCES) {
    gains[resource] = Math.max(0, next[resource] - previous[resource]);
  }
  return gains;
}
