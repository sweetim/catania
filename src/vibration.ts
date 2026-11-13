import { useEffect, useRef } from "react";

const TURN_START_VIBRATION: number[] = [80, 60, 80];

/** Vibrates the device when the turn arrives at the local player. Mounting while already active never vibrates. */
export function useVibrateOnYourTurn(active: boolean, enabled: boolean) {
  const wasActive = useRef(active);
  useEffect(() => {
    const turnArrived = active && !wasActive.current;
    wasActive.current = active;
    if (turnArrived && enabled && typeof navigator.vibrate === "function") {
      navigator.vibrate(TURN_START_VIBRATION);
    }
  }, [active, enabled]);
}
