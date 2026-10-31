import { useEffect, useState } from "react";
import { useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";
import { Dialog } from "./GameUi";

const BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY = "catania.showBlockedSettlementLocations";
const FILL_BOARD_WITH_WATER_STORAGE_KEY = "catania.fillBoardWithWater";

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

  return {
    showBlockedSettlementLocations,
    setShowBlockedSettlementLocations,
    fillBoardWithWater,
    setFillBoardWithWater,
  };
}

export function BoardSettingsDialog({
  onClose,
  showBlockedSettlementLocations,
  setShowBlockedSettlementLocations,
  fillBoardWithWater,
  setFillBoardWithWater,
}: ReturnType<typeof useBoardSettings> & { onClose: () => void }) {
  const translateText = useTranslation(boardTranslations);
  return (
    <Dialog title={translateText("Settings")} onClose={onClose}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={showBlockedSettlementLocations}
          onChange={(event) => setShowBlockedSettlementLocations(event.currentTarget.checked)}
          aria-describedby="blocked-settlement-locations-description"
          className="size-5 shrink-0 accent-forest"
        />
        {translateText("Show blocked settlement locations")}
      </label>
      <p id="blocked-settlement-locations-description" className="mt-3 text-sm leading-6 text-muted">
        {translateText("Crosses mark empty corners next to any settlement or city, where the distance rule prevents building. Unmarked corners still require the usual roads, resources, and available pieces on your turn.")}
      </p>
      <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={fillBoardWithWater}
          onChange={(event) => setFillBoardWithWater(event.currentTarget.checked)}
          aria-describedby="fill-board-with-water-description"
          className="size-5 shrink-0 accent-forest"
        />
        {translateText("Fill board with water")}
      </label>
      <p id="fill-board-with-water-description" className="mt-3 text-sm leading-6 text-muted">
        {translateText("Extend the water background to fill the entire map area. Off by default to keep the round water shape.")}
      </p>
      <p className="mt-4 text-xs text-muted">{translateText("Saved in this browser when storage is available. Games are not saved.")}</p>
    </Dialog>
  );
}
