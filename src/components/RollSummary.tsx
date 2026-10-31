import type { RollOutcome } from "../rollPresentation";
import { RESOURCES } from "../game/engine";
import { RESOURCE_NAMES } from "./GameUi";

export type RollStage = "rolling" | "production" | "received" | "complete";

const DIE_PIPS = [
  [], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8],
];

export function RollSummary({ outcome, stage = "complete", viewerId }: {
  outcome?: RollOutcome;
  stage?: RollStage;
  viewerId?: string;
}) {
  const rolling = Boolean(outcome) && stage === "rolling";
  const received = Boolean(outcome) && (stage === "received" || stage === "complete");
  const dice = outcome?.dice ?? [1, 1];
  const total = dice[0]! + dice[1]!;
  const title = !outcome
    ? "Waiting for the next roll."
    : rolling
      ? `${outcome.playerName} is rolling...`
      : `${outcome.playerName} rolled ${dice[0]} + ${dice[1]} = ${total}.`;
  const result = !outcome
    ? "The next roll will appear here."
    : total === 7
      ? "No resources produced. Resolve any discards, then move the robber."
      : outcome.totalReceived
        ? `The island supplied ${outcome.totalReceived} resource card${outcome.totalReceived === 1 ? "" : "s"}.`
        : "No resources produced this roll.";
  const details = [
    result,
    outcome?.blockedTileIds.length ? "The robber blocked a matching hex." : "",
    outcome?.shortages.length
      ? `Bank shortage: ${outcome.shortages.map(resource => RESOURCE_NAMES[resource]).join(", ")}. Not all resources could be supplied.`
      : "",
  ].filter(Boolean).join(" ");
  const gains = viewerId ? outcome?.gains[viewerId] : undefined;
  const gainDescription = gains && RESOURCES
    .filter(resource => gains[resource] > 0)
    .map(resource => `+${gains[resource]} ${RESOURCE_NAMES[resource]}`)
    .join(", ");
  const privateSummary = gains && total !== 7
    ? gainDescription ? `You received ${gainDescription}.` : "You received no resources this roll."
    : "";

  return (
    <>
      {/* Keep announcements mounted when reduced motion skips timed stages. */}
      <p role="status" aria-label="Roll announcement" aria-atomic="true" className="sr-only">
        {received ? `${title} ${details}` : ""}
      </p>
      <section
        aria-label={outcome ? "Roll result" : "Dice tray"}
        data-stage={outcome ? stage : "idle"}
        className="roll-summary flex min-h-0 items-start gap-3 rounded-2xl border border-[#c9b983] bg-[#f4edda] px-3 py-3 sm:items-center sm:px-4"
      >
        <div
          role="img"
          aria-label={!outcome ? "Dice at rest" : rolling ? "Dice rolling" : `Dice: ${dice[0]} and ${dice[1]}`}
          className={`roll-summary-dice flex shrink-0 gap-1.5 pt-0.5 ${rolling ? "dice-rolling" : ""} ${outcome ? "" : "opacity-60"}`}
        >
          {dice.map((value, index) => (
            <svg key={index} aria-hidden="true" viewBox="0 0 48 48" className="roll-die h-9 w-9 sm:h-11 sm:w-11">
              <rect x="2" y="4" width="44" height="42" rx="10" fill="#c9b983" />
              <rect x="2" y="2" width="44" height="42" rx="10" fill="#fffaf0" stroke="#b8a777" />
              {DIE_PIPS[rolling ? 5 : value]!.map(position => (
                <circle key={position} cx={14 + (position % 3) * 10} cy={13 + Math.floor(position / 3) * 10} r="3" fill="#315e49" />
              ))}
            </svg>
          ))}
        </div>
        <div className="roll-summary-content min-h-0 min-w-0 flex-1">
          <p className="roll-summary-title min-h-5 text-sm font-semibold text-forest">{title}</p>
          <p className="roll-summary-details mt-1 min-h-0 overflow-y-auto overscroll-contain text-xs leading-5 text-muted">
            {!outcome ? result : rolling ? "A little chance. A little possibility." : received ? details : "Following the roll across the island..."}
          </p>
          <p className="roll-summary-private mt-1 min-h-5 text-xs font-semibold leading-5 text-forest">
            {received ? privateSummary : ""}
          </p>
        </div>
      </section>
    </>
  );
}
