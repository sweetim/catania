import type { RollOutcome } from "../rollPresentation";
import { RESOURCES } from "../game/engine";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCard } from "./GameUi";

export type RollStage = "rolling" | "production" | "received" | "complete";

const DIE_PIPS = [
  [], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8],
];

export function Dice({ dice, rolling = false }: {
  dice?: readonly [number, number] | null;
  rolling?: boolean;
}) {
  const translateText = useTranslation(gameplayTranslations);
  return (
    <div
      role="img"
      aria-label={!dice ? translateText("Dice at rest") : rolling ? translateText("Dice rolling") : translateText("Dice: {first} and {second}", { first: dice[0], second: dice[1] })}
      className={`roll-summary-dice flex shrink-0 gap-1.5 ${rolling ? "dice-rolling" : ""} ${dice ? "" : "opacity-60"}`}
    >
      {(dice ?? [1, 1]).map((value, index) => (
        <svg key={index} aria-hidden="true" viewBox="0 0 48 48" className="roll-die">
          <rect x="2" y="4" width="44" height="42" rx="10" fill="#c9b983" />
          <rect x="2" y="2" width="44" height="42" rx="10" fill="#fffaf0" stroke="#b8a777" />
          {DIE_PIPS[value]!.map(position => (
            <circle key={position} cx={14 + (position % 3) * 10} cy={13 + Math.floor(position / 3) * 10} r="3" fill="#315e49" />
          ))}
        </svg>
      ))}
    </div>
  );
}

export function RollSummary({ outcome, stage = "complete", viewerId, seafarers = false }: {
  outcome?: RollOutcome;
  stage?: RollStage;
  viewerId?: string;
  seafarers?: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const rolling = Boolean(outcome) && stage === "rolling";
  const received = Boolean(outcome) && (stage === "received" || stage === "complete");
  const dice = outcome?.dice ?? [1, 1];
  const total = dice[0]! + dice[1]!;
  const title = !outcome
    ? translateText("Waiting for the next roll.")
    : rolling
      ? translateText("{player} is rolling...", { player: outcome.playerName })
      : translateText("{player} rolled {first} + {second} = {total}.", { player: outcome.playerName, first: dice[0]!, second: dice[1]!, total });
  const result = !outcome
    ? translateText("The next roll will appear here.")
    : total === 7
      ? translateText(seafarers ? "No resources produced. Resolve any discards, then move the robber or pirate." : "No resources produced. Resolve any discards, then move the robber.")
      : outcome.totalReceived
        ? translateText(outcome.totalReceived === 1 ? "The island supplied {count} resource card." : "The island supplied {count} resource cards.", { count: outcome.totalReceived })
        : outcome.pendingGold ? translateText("{count} resource choices await gold production.", { count: outcome.pendingGold }) : translateText("No resources produced this roll.");
  const details = [
    result,
    outcome?.totalReceived && outcome.pendingGold ? translateText("{count} resource choices await gold production.", { count: outcome.pendingGold }) : "",
    outcome?.blockedTileIds.length ? translateText("The robber blocked a matching hex.") : "",
    outcome?.shortages.length
      ? translateText("Bank shortage: {resources}. Not all resources could be supplied.", { resources: outcome.shortages.map(resource => resourceName(language, resource)).join(language === "ja" ? "、" : ", ") })
      : "",
  ].filter(Boolean).join(" ");
  const gains = viewerId ? outcome?.gains[viewerId] : undefined;
  const gainedResources = gains ? RESOURCES.filter(resource => gains[resource] > 0) : [];

  return (
    <>
      {/* Keep announcements mounted when reduced motion skips timed stages. */}
      <p role="status" aria-label={translateText("Roll announcement")} aria-atomic="true" className="sr-only">
        {received ? `${title} ${details}` : ""}
      </p>
      <section
        aria-label={translateText(outcome ? "Roll result" : "Dice tray")}
        data-stage={outcome ? stage : "idle"}
        className="roll-summary"
      >
        <Dice dice={outcome?.dice} rolling={rolling} />
        <div className="roll-summary-content">
          {received && gains && total !== 7 && gainedResources.length > 0 ? (
            <div className="roll-summary-private">
              <p className="roll-summary-label">{translateText("You received")}</p>
              <ul className="roll-summary-rewards" aria-label={translateText("Your roll rewards")}>
                {gainedResources.map(resource => (
                  <li key={resource} aria-label={translateText("{resource} +{count}", { resource: resourceName(language, resource), count: gains[resource] })} title={translateText("You received +{count} {resource}", { count: gains[resource], resource: resourceName(language, resource) })}>
                    <ResourceCard resource={resource} iconClassName="h-4 w-4" className="roll-summary-resource" />
                    <strong aria-hidden="true" className="roll-summary-gain">+{gains[resource]}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : received && gains && total !== 7 ? (
            <p className="roll-summary-title">{translateText("You received no resources this roll.")}</p>
          ) : !outcome || rolling ? (
            <p className="roll-summary-title">{translateText(rolling ? "Rolling..." : "Waiting for the next roll.")}</p>
          ) : null}
        </div>
      </section>
    </>
  );
}
