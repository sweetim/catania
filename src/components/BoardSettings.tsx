import { useEffect, useState } from "react";
import { useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";
import { Dialog } from "./GameUi";

const BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY = "catania.showBlockedSettlementLocations";
const FILL_BOARD_WITH_WATER_STORAGE_KEY = "catania.fillBoardWithWater";
const VIBRATE_ON_YOUR_TURN_STORAGE_KEY = "catania.vibrateOnYourTurn";

export function useBoardSettings() {
  const [showBlockedSettlementLocations, setShowBlockedSettlementLocations] = useState(() => {
    try {
      return window.localStorage.getItem(BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [fillBoardWithWater, setFillBoardWithWater] = useState(() => {
    try {
      return window.localStorage.getItem(FILL_BOARD_WITH_WATER_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [vibrateOnYourTurn, setVibrateOnYourTurn] = useState(() => {
    try {
      return window.localStorage.getItem(VIBRATE_ON_YOUR_TURN_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY, String(showBlockedSettlementLocations));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [showBlockedSettlementLocations]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILL_BOARD_WITH_WATER_STORAGE_KEY, String(fillBoardWithWater));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [fillBoardWithWater]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIBRATE_ON_YOUR_TURN_STORAGE_KEY, String(vibrateOnYourTurn));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [vibrateOnYourTurn]);

  return {
    showBlockedSettlementLocations,
    setShowBlockedSettlementLocations,
    fillBoardWithWater,
    setFillBoardWithWater,
    vibrateOnYourTurn,
    setVibrateOnYourTurn,
  };
}

function SettingRow({
  label,
  descriptionId,
  description,
  checked,
  onChange,
}: {
  label: string;
  descriptionId: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-white/40 p-4">
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm font-semibold">
        {label}
        <span className="relative inline-flex h-6 w-11 shrink-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.currentTarget.checked)}
            aria-describedby={descriptionId}
            className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-ink/20 transition-colors peer-checked:bg-forest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest"
          />
          <span
            aria-hidden="true"
            className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
          />
        </span>
      </label>
      <p id={descriptionId} className="mt-1.5 text-xs leading-5 text-muted">{description}</p>
    </div>
  );
}

export function BoardSettingsDialog({
  onClose,
  showBlockedSettlementLocations,
  setShowBlockedSettlementLocations,
  fillBoardWithWater,
  setFillBoardWithWater,
  vibrateOnYourTurn,
  setVibrateOnYourTurn,
}: ReturnType<typeof useBoardSettings> & { onClose: () => void }) {
  const translateText = useTranslation(boardTranslations);
  return (
    <Dialog title={translateText("Settings")} onClose={onClose}>
      <h3 className="eyebrow">{translateText("Board")}</h3>
      <div className="mt-2 space-y-2">
        <SettingRow
          label={translateText("Show blocked settlement locations")}
          descriptionId="blocked-settlement-locations-description"
          description={translateText("Crosses mark corners where the distance rule prevents building.")}
          checked={showBlockedSettlementLocations}
          onChange={setShowBlockedSettlementLocations}
        />
        <SettingRow
          label={translateText("Fill board with water")}
          descriptionId="fill-board-with-water-description"
          description={translateText("Extend water to the entire map area instead of the round shape. Off by default.")}
          checked={fillBoardWithWater}
          onChange={setFillBoardWithWater}
        />
      </div>
      <h3 className="eyebrow mt-5">{translateText("Feedback")}</h3>
      <div className="mt-2 space-y-2">
        <SettingRow
          label={translateText("Vibrate when your turn starts")}
          descriptionId="vibrate-on-your-turn-description"
          description={translateText("A short vibration when the turn passes to you on this device. On by default.")}
          checked={vibrateOnYourTurn}
          onChange={setVibrateOnYourTurn}
        />
      </div>
      <p className="mt-5 border-t border-line pt-3 text-xs text-muted">{translateText("Saved in this browser. Games are not saved.")}</p>
    </Dialog>
  );
}
