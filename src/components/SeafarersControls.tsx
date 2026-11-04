import { useState } from "react";
import { emptyResources, resourceTotal } from "../game/engine";
import type { GamePhase, Resources } from "../game/types";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCardStepper } from "./GameUi";

export function GoldSelection({ bank, count, onSubmit, disabled = false }: {
  bank: Resources;
  count: number;
  onSubmit: (resources: Resources) => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(gameplayTranslations);
  const [chosen, setChosen] = useState(emptyResources);
  const required = Math.min(count, resourceTotal(bank));
  return <section className="my-3 space-y-3 rounded-xl border border-line p-3" aria-label={translateText("Choose your gold resources")}>
    <h2 className="font-semibold">{translateText("Choose your gold resources")}</h2>
    <p className="text-xs">{translateText("Choose {count} available resource cards.", { count: required })}</p>
    <fieldset disabled={disabled}>
      <ResourceCardStepper label={translateText("Take from the bank")} values={chosen} maximum={bank}
        maximumLabel="In bank" onChange={setChosen} />
    </fieldset>
    <button className="button-primary w-full" disabled={disabled || resourceTotal(chosen) !== required}
      onClick={() => onSubmit(chosen)}>{translateText("Collect resources")}</button>
  </section>;
}

export function FreeRouteChoice({ phase, mode, onSelect, disabled = false }: {
  phase: GamePhase;
  mode: string | null;
  onSelect: (mode: "road" | "ship") => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(gameplayTranslations);
  if (phase.type !== "setup-road" && phase.type !== "road-building") return null;
  return <div className="my-2 flex gap-2">
    {(["road", "ship"] as const).map(piece => <button key={piece} className="button-secondary flex-1 px-2 text-xs"
      aria-label={translateText(piece === "ship" ? "Choose ships" : "Choose roads")}
      disabled={disabled} aria-pressed={mode === piece} onClick={() => onSelect(piece)}>
      {translateText(piece === "ship" ? "Build ship" : "Build road")}
    </button>)}
  </div>;
}
