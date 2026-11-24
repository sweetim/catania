import { useState } from "react";
import { emptyResources, resourceTotal } from "../game/engine";
import type { Resources } from "../game/types";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCardStepper } from "./GameUi";
import { GoldIcon } from "./Icons";

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
    <h2 className="flex items-center gap-2 font-semibold">
      <GoldIcon className="h-4 w-4 shrink-0 text-[#b58a2d]" />
      {translateText("Choose your gold resources")}
    </h2>
    <p className="text-xs">{translateText("Choose {count} available resource cards.", { count: required })}</p>
    <fieldset disabled={disabled}>
      <ResourceCardStepper label={translateText("Take from the bank")} values={chosen} maximum={bank}
        maximumLabel="In bank" onChange={setChosen} />
    </fieldset>
    <button className="button-primary w-full" disabled={disabled || resourceTotal(chosen) !== required}
      onClick={() => onSubmit(chosen)}>{translateText("Collect resources")}</button>
  </section>;
}
