import { type CSSProperties, type ReactNode } from "react";
import { match } from "ts-pattern";
import { DevelopmentCardIcon, PieceIcon } from "./GameUi";

export type VictoryBreakdownKind =
  | "settlements"
  | "cities"
  | "longest-road"
  | "largest-army"
  | "victory-point-cards"
  | "islands";

export type VictoryBreakdownRow = {
  kind: VictoryBreakdownKind;
  label: string;
  note?: string;
  points: number;
};

const CONFETTI_COLORS = ["#b58a2d", "#bb6549", "#b0cdc1", "#8b6425", "#e9d8a6", "#253b36"];
const CONFETTI_PIECES = Array.from({ length: 28 }, (_, index) => ({
  left: (index * 37 + 13) % 100,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]!,
  delay: ((index * 173) % 32) / 10,
  duration: 28 + ((index * 97) % 14) / 10,
  width: 7 + (index % 3) * 2,
  height: 10 + ((index * 7) % 3) * 3,
  rotation: 360 + (index % 5) * 180,
  round: index % 4 === 0,
}));

function Confetti() {
  return (
    <div aria-hidden="true" className="confetti-layer">
      {CONFETTI_PIECES.map((piece, index) => (
        <span
          key={index}
          className="confetti-piece"
          style={{
            left: `${piece.left}%`,
            width: piece.width,
            height: piece.height,
            backgroundColor: piece.color,
            borderRadius: piece.round ? "50%" : "2px",
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            "--confetti-rotation": `${piece.rotation}deg`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function BreakdownIcon({ kind }: { kind: VictoryBreakdownKind }) {
  return match(kind)
    .with("settlements", () => (
      <span className="victory-chip bg-forest/45 text-ink"><PieceIcon piece="settlement" /></span>
    ))
    .with("cities", () => (
      <span className="victory-chip bg-forest/45 text-ink"><PieceIcon piece="city" /></span>
    ))
    .with("longest-road", () => (
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]"><PieceIcon piece="road" /></span>
    ))
    .with("largest-army", () => (
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]">
        <svg viewBox="0 0 24 28" className="h-6 w-5 shrink-0" fill="none" aria-hidden="true">
          <path d="m3 3 5 2 11 13-3 3L5 8 3 3Zm18 0-5 2L5 18l3 3L19 8l2-5Z" fill="currentColor" />
          <path d="m13 21 7-6M4 15l7 6m6 0 3 4M7 21l-3 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    ))
    .with("victory-point-cards", "islands", () => (
      <span className="victory-chip bg-[#947231]/15 text-[#947231]"><DevelopmentCardIcon kind="victory-point" /></span>
    ))
    .exhaustive();
}

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
      <Confetti />
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
          <p className="mt-5 font-serif text-5xl tabular-nums text-[#8b6425]">
            {totalPoints}
            <span className="ml-2 align-middle text-sm font-semibold uppercase tracking-[.12em] text-muted">{pointsUnit}</span>
          </p>
          {breakdown.length > 0 && (
            <dl className="mt-5 space-y-2.5 rounded-xl bg-moss/60 p-3.5 text-sm">
              {breakdown.map(row => (
                <div className="flex items-center gap-3" key={row.kind}>
                  <BreakdownIcon kind={row.kind} />
                  <dt className="min-w-0 flex-1">
                    <span className="block leading-5">{row.label}</span>
                    {row.note && <span className="block text-xs leading-4 text-muted">{row.note}</span>}
                  </dt>
                  <dd className="text-base font-bold tabular-nums">{row.points}</dd>
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
