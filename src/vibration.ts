import { useEffect, useRef } from "react";
import { triggerNativeHaptic } from "./nativeBridge";

const TURN_START_VIBRATION: number[] = [80, 60, 80];
const INCOMING_TRADE_VIBRATION: number[] = [60];

/** Vibrates the device when the turn arrives at the local player. Mounting while already active never vibrates. */
export function useVibrateOnYourTurn(active: boolean, enabled: boolean) {
  const wasActive = useRef(active);
  useEffect(() => {
    const turnArrived = active && !wasActive.current;
    wasActive.current = active;
    if (turnArrived && enabled) {
      if (!triggerNativeHaptic("turnStart") && typeof navigator.vibrate === "function") {
        navigator.vibrate(TURN_START_VIBRATION);
      }
    }
  }, [active, enabled]);
}

/** Vibrates the device briefly when a new incoming trade arrives. Mounting with an existing trade never vibrates. */
export function useVibrateOnIncomingTrade(tradeIdentity: string | null, incoming: boolean, enabled: boolean) {
  const previousIdentity = useRef<string | null>(incoming ? tradeIdentity : null);
  useEffect(() => {
    const nextIdentity = incoming ? tradeIdentity : null;
    const arrived = nextIdentity !== null && nextIdentity !== previousIdentity.current;
    previousIdentity.current = nextIdentity;
    if (arrived && enabled) {
      if (!triggerNativeHaptic("incomingTrade") && typeof navigator.vibrate === "function") {
        navigator.vibrate(INCOMING_TRADE_VIBRATION);
      }
    }
  }, [tradeIdentity, incoming, enabled]);
}
