import type { ReactNode } from "react";

export type VictoryBreakdownRow = { label: string; points: number };

export function VictoryDialog({
  eyebrow,
  headline,
  winnerName,
  winnerColor,
  totalPoints,
  pointsUnit,
  summary,
  breakdown,
  children,
}: {
  eyebrow: string;
  headline: string;
  winnerName: string;
  winnerColor: string;
  totalPoints: number;
  pointsUnit: string;
  summary: string;
  breakdown: readonly VictoryBreakdownRow[];
  children: ReactNode;
}) {
  return (
    <div
      className="victory-overlay fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={headline}
    >
      <div className="victory-card panel w-full max-w-md p-6 text-center sm:p-8">
        <div className="victory-stagger text-left">
          <p className="eyebrow">{eyebrow}</p>
          <div className="mt-3 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
              style={{ background: winnerColor }}
            >
              {winnerName.charAt(0).toUpperCase()}
            </span>
            <h2 className="min-w-0 font-serif text-2xl leading-tight">{headline}</h2>
          </div>
          <p className="mt-5 font-serif text-5xl tabular-nums">
            {totalPoints}
            <span className="ml-2 align-middle text-sm font-semibold uppercase tracking-[.12em] text-muted">{pointsUnit}</span>
          </p>
          {breakdown.length > 0 && (
            <dl className="mt-5 space-y-2 rounded-xl bg-moss/60 p-4 text-sm">
              {breakdown.map(row => (
                <div className="flex justify-between gap-4" key={row.label}>
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="font-semibold tabular-nums">{row.points}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-sm leading-6 text-muted">{summary}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
