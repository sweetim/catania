import { useState } from "react";
import { emptyResources, resourceTotal, RESOURCES } from "../game/engine";
import type { Resources } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Dialog, ResourceCard } from "./GameUi";
import { GoldIcon, MinusIcon, PlusIcon } from "./Icons";

export function GoldSelection({ hand, bank, count, onSubmit, onClose, disabled = false }: {
  hand: Resources;
  bank: Resources;
  count: number;
  onSubmit: (resources: Resources) => void;
  onClose?: () => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const [chosen, setChosen] = useState(emptyResources);
  const required = Math.min(count, resourceTotal(bank));
  const selected = resourceTotal(chosen);
  const title = required === 0 ? translateText("Choose your gold resources")
    : translateText(required === 1 ? "Choose {count} gold resource" : "Choose {count} gold resources", { count: required });
  const buttonLabel = required === 0 ? translateText("Continue")
    : translateText(required === 1 ? "Collect {count} resource" : "Collect {count} resources", { count: required });
  const picker = <>
    <p role="status" className="mb-2 flex items-center gap-2 rounded-lg bg-[#f1e7cd] px-3 py-2 text-sm font-semibold tabular-nums">
      <GoldIcon className="h-4 w-4 shrink-0 text-[#8e6920]" />
      {required === 0 ? translateText("The bank has no resources left.")
        : translateText("Selected {selected} of {required}", { selected, required })}
    </p>
    <table className="w-full table-fixed border-separate border-spacing-0 text-sm tabular-nums">
      <thead className="text-center text-[11px] text-muted">
        <tr>
          <th scope="col" className="text-left"><span className="sr-only">{translateText("Resource")}</span></th>
          <th scope="col" className="w-14 py-1.5 sm:w-16">{translateText("In hand")}</th>
          <th scope="col" className="w-28 py-1.5">{translateText("Pick")}</th>
        </tr>
      </thead>
      <tbody>
        {RESOURCES.map(resource => {
          const name = resourceName(language, resource);
          const amount = chosen[resource];
          const available = bank[resource];
          return <tr key={resource} className={amount > 0 ? "bg-moss" : undefined}>
            <th scope="row" className="border-t border-line py-1 text-left">
              <span className="flex items-center gap-1 text-xs font-semibold sm:gap-2 sm:text-sm">
                <ResourceCard resource={resource} compact iconClassName="size-3.5"
                  className={`size-[1.375rem] shrink-0 rounded-md ${available === 0 ? "grayscale" : ""}`} />
                {name}
              </span>
            </th>
            <td className="border-t border-line text-center">{hand[resource]}</td>
            <td className="h-12 border-t border-line text-center">
              {available === 0 ? <span className="text-[11px] font-medium text-muted">{translateText("Out of stock")}</span>
                : <div className="grid grid-cols-[2.75rem_1.5rem_2.75rem] items-center">
                  <button type="button" className="gold-picker-step" aria-label={translateText("Remove {resource}", { resource: name })}
                    disabled={disabled || amount === 0} onClick={() => setChosen({ ...chosen, [resource]: amount - 1 })}>
                    <MinusIcon className="size-4" />
                  </button>
                  <span className="text-base font-bold">{amount}</span>
                  <button type="button" className="gold-picker-step" aria-label={translateText("Add {resource}", { resource: name })}
                    disabled={disabled || amount >= available || selected >= required} onClick={() => setChosen({ ...chosen, [resource]: amount + 1 })}>
                    <PlusIcon className="size-4" />
                  </button>
                </div>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
    <div className="gold-picker-actions">
      <button type="button" className="button-primary w-full" disabled={disabled || selected !== required}
        onClick={() => onSubmit(chosen)}>{buttonLabel}</button>
    </div>
  </>;

  return onClose ? <Dialog title={title} onClose={onClose}>{picker}</Dialog>
    : <section className="hand-task gold-picker panel px-3 pt-3" role="region" aria-label={title}>
      <h2 className="mb-2 font-serif text-xl">{title}</h2>
      {picker}
  </section>;
}
