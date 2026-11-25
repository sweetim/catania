import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import { useTranslation } from "../localization";
import { appTranslations } from "../translations/app";
import { DevelopmentCardIcon, IslandIcon, PieceIcon } from "./GameUi";
import { CheckIcon, CrownIcon, LargestArmyIcon, LongestRoadAwardIcon, MapFoldIcon, MasterSaboteurAwardIcon } from "./Icons";

export type VictoryBreakdownKind =
  | "settlements"
  | "cities"
  | "longest-road"
  | "largest-army"
  | "master-saboteur"
  | "victory-point-cards"
  | "islands";

export type VictoryBreakdownRow = {
  kind: VictoryBreakdownKind;
  label: string;
  note?: string;
  points: number;
};

type ConfettiShape = "rectangle" | "ribbon" | "diamond" | "foil";

type ConfettiColor = {
  front: string;
  back: string;
  metallic: boolean;
};

type ConfettiParticle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  width: number;
  height: number;
  shape: ConfettiShape;
  color: ConfettiColor;
  dragRate: number;
  gravity: number;
  terminalVelocity: number;
  spinAngle: number;
  spinVelocity: number;
  tiltAngle: number;
  tiltVelocity: number;
  wobblePhase: number;
  wobbleSpeed: number;
  flutterStrength: number;
  age: number;
  lifetime: number;
};

const BASE_CONFETTI_COLORS: readonly ConfettiColor[] = [
  { front: "#d7aa44", back: "#9e7724", metallic: true },
  { front: "#f2df9f", back: "#c6a34a", metallic: true },
  { front: "#b58a2d", back: "#7e5e1c", metallic: true },
  { front: "#bb6549", back: "#8b4631", metallic: false },
  { front: "#7ea998", back: "#557d6e", metallic: false },
  { front: "#f6ebd0", back: "#d5c194", metallic: false },
  { front: "#2e4b44", back: "#1d322d", metallic: false },
];

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function shadeHexColor(hexColor: string, factor: number): string {
  const trimmed = hexColor.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  const fullHex = shortMatch
    ? shortMatch[1]!.split("").map(character => character + character).join("")
    : /^#([0-9a-f]{6})$/i.exec(trimmed)?.[1] ?? null;
  if (!fullHex) return hexColor;
  const red = Math.max(0, Math.min(255, Math.round(Number.parseInt(fullHex.slice(0, 2), 16) * factor)));
  const green = Math.max(0, Math.min(255, Math.round(Number.parseInt(fullHex.slice(2, 4), 16) * factor)));
  const blue = Math.max(0, Math.min(255, Math.round(Number.parseInt(fullHex.slice(4, 6), 16) * factor)));
  return `rgb(${red}, ${green}, ${blue})`;
}

function pickConfettiShape(): ConfettiShape {
  const roll = Math.random();
  if (roll < 0.48) return "rectangle";
  if (roll < 0.72) return "ribbon";
  if (roll < 0.88) return "diamond";
  return "foil";
}

function buildConfettiPalette(winnerColor: string): readonly ConfettiColor[] {
  const winnerAccent: ConfettiColor = {
    front: winnerColor,
    back: shadeHexColor(winnerColor, 0.72),
    metallic: false,
  };
  return [...BASE_CONFETTI_COLORS, winnerAccent, winnerAccent];
}

function createConfettiParticle({
  originX,
  originY,
  angleRadians,
  speed,
  palette,
  lifetimeScale = 1,
}: {
  originX: number;
  originY: number;
  angleRadians: number;
  speed: number;
  palette: readonly ConfettiColor[];
  lifetimeScale?: number;
}): ConfettiParticle {
  const shape = pickConfettiShape();
  const color = shape === "foil"
    ? BASE_CONFETTI_COLORS[Math.floor(Math.random() * 3)]!
    : palette[Math.floor(Math.random() * palette.length)]!;

  const dimensions = match(shape)
    .with("rectangle", () => ({
      width: randomBetween(7.5, 12),
      height: randomBetween(4.2, 6.8),
      dragRate: randomBetween(2.1, 2.9),
      terminalVelocity: randomBetween(135, 215),
    }))
    .with("ribbon", () => ({
      width: randomBetween(12, 18),
      height: randomBetween(3.2, 4.6),
      dragRate: randomBetween(2.5, 3.3),
      terminalVelocity: randomBetween(105, 165),
    }))
    .with("diamond", () => ({
      width: randomBetween(7.5, 11),
      height: randomBetween(6.5, 9.5),
      dragRate: randomBetween(2.0, 2.8),
      terminalVelocity: randomBetween(140, 220),
    }))
    .with("foil", () => ({
      width: randomBetween(4.5, 6.8),
      height: randomBetween(4.5, 6.8),
      dragRate: randomBetween(1.8, 2.5),
      terminalVelocity: randomBetween(115, 180),
    }))
    .exhaustive();

  return {
    x: originX,
    y: originY,
    velocityX: Math.cos(angleRadians) * speed,
    velocityY: Math.sin(angleRadians) * speed,
    width: dimensions.width,
    height: dimensions.height,
    shape,
    color,
    dragRate: dimensions.dragRate,
    gravity: randomBetween(520, 740),
    terminalVelocity: dimensions.terminalVelocity,
    spinAngle: randomBetween(0, Math.PI * 2),
    spinVelocity: randomBetween(-5.5, 5.5),
    tiltAngle: randomBetween(0, Math.PI * 2),
    tiltVelocity: randomBetween(6, 13) * (Math.random() < 0.5 ? -1 : 1),
    wobblePhase: randomBetween(0, Math.PI * 2),
    wobbleSpeed: randomBetween(3.2, 6.4),
    flutterStrength: randomBetween(38, 86),
    age: 0,
    lifetime: randomBetween(3.2, 5.1) * lifetimeScale,
  };
}

function drawConfettiParticle(context: CanvasRenderingContext2D, particle: ConfettiParticle) {
  const fadeIn = Math.min(1, particle.age / 0.06);
  const fadeOut = Math.min(1, Math.max(0, (particle.lifetime - particle.age) / 0.95));
  const opacity = fadeIn * fadeOut;
  if (opacity <= 0.01) return;

  const tiltCosine = Math.cos(particle.tiltAngle);
  const foreshorten = Math.max(0.14, Math.abs(tiltCosine));
  const halfWidth = particle.width / 2;
  const halfHeight = particle.height / 2;
  const fillStyle = tiltCosine >= 0 ? particle.color.front : particle.color.back;
  const specularGlint = particle.color.metallic && Math.abs(tiltCosine) > 0.16 && Math.abs(tiltCosine) < 0.38;

  context.save();
  context.globalAlpha = opacity;
  context.translate(particle.x, particle.y);
  context.rotate(particle.spinAngle);
  context.scale(1, foreshorten);
  context.fillStyle = fillStyle;

  const drawShapePath = () => {
    match(particle.shape)
      .with("rectangle", () => {
        context.beginPath();
        context.rect(-halfWidth, -halfHeight, particle.width, particle.height);
        context.fill();
      })
      .with("ribbon", () => {
        const wave = Math.sin(particle.wobblePhase) * 2.2;
        context.beginPath();
        context.moveTo(-halfWidth, -halfHeight + wave * 0.4);
        context.quadraticCurveTo(0, -halfHeight - wave, halfWidth, -halfHeight + wave * 0.4);
        context.lineTo(halfWidth, halfHeight + wave * 0.4);
        context.quadraticCurveTo(0, halfHeight - wave, -halfWidth, halfHeight + wave * 0.4);
        context.closePath();
        context.fill();
      })
      .with("diamond", () => {
        context.beginPath();
        context.moveTo(0, -halfHeight);
        context.lineTo(halfWidth, 0);
        context.lineTo(0, halfHeight);
        context.lineTo(-halfWidth, 0);
        context.closePath();
        context.fill();
      })
      .with("foil", () => {
        context.beginPath();
        context.moveTo(0, -halfHeight);
        context.lineTo(halfWidth * 0.85, 0);
        context.lineTo(0, halfHeight);
        context.lineTo(-halfWidth * 0.85, 0);
        context.closePath();
        context.fill();
      })
      .exhaustive();
  };

  drawShapePath();
  if (specularGlint) {
    context.fillStyle = "rgba(255, 250, 232, 0.68)";
    drawShapePath();
  }
  context.restore();
}

function Confetti({ winnerColor }: { winnerColor: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"active" | "complete" | "reduced">("active");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("reduced");
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    setState("active");
    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;

    const resizeCanvas = () => {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(viewportWidth * devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(viewportHeight * devicePixelRatio));
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const palette = buildConfettiPalette(winnerColor);
    const particles: ConfettiParticle[] = [];

    const spawnSideCannons = (countPerSide: number, originYRatio: number, speedMultiplier: number) => {
      const compact = viewportWidth < 640;
      const baseSpeed = Math.max(760, Math.min(1680, viewportHeight * 1.52)) * speedMultiplier;
      const minAngleDegrees = compact ? 58 : 38;
      const maxAngleDegrees = compact ? 84 : 76;

      for (let index = 0; index < countPerSide; index++) {
        const leftDegrees = -randomBetween(minAngleDegrees, maxAngleDegrees);
        particles.push(createConfettiParticle({
          originX: viewportWidth * randomBetween(0.01, 0.08),
          originY: viewportHeight * (originYRatio + randomBetween(-0.04, 0.04)),
          angleRadians: (leftDegrees * Math.PI) / 180,
          speed: baseSpeed * randomBetween(0.55, 1.15),
          palette,
        }));

        const rightDegrees = -180 + randomBetween(minAngleDegrees, maxAngleDegrees);
        particles.push(createConfettiParticle({
          originX: viewportWidth * randomBetween(0.92, 0.99),
          originY: viewportHeight * (originYRatio + randomBetween(-0.04, 0.04)),
          angleRadians: (rightDegrees * Math.PI) / 180,
          speed: baseSpeed * randomBetween(0.55, 1.15),
          palette,
        }));
      }
    };

    const spawnOverheadFlutter = (count: number) => {
      for (let index = 0; index < count; index++) {
        particles.push(createConfettiParticle({
          originX: viewportWidth * randomBetween(0.1, 0.9),
          originY: randomBetween(-24, viewportHeight * 0.08),
          angleRadians: (randomBetween(68, 112) * Math.PI) / 180,
          speed: randomBetween(80, 210),
          palette,
          lifetimeScale: 0.95,
        }));
      }
    };

    spawnSideCannons(46, 0.88, 1);

    let secondaryWaveSpawned = false;
    let animationFrameId = 0;
    let startTimestamp: number | null = null;
    let previousTimestamp: number | null = null;

    const step = (timestamp: number) => {
      if (startTimestamp === null) startTimestamp = timestamp;
      const deltaSeconds = previousTimestamp === null
        ? 1 / 60
        : Math.min(0.05, Math.max(0.001, (timestamp - previousTimestamp) / 1000));
      previousTimestamp = timestamp;

      const elapsedSeconds = (timestamp - startTimestamp) / 1000;
      if (!secondaryWaveSpawned && elapsedSeconds >= 0.32) {
        secondaryWaveSpawned = true;
        spawnSideCannons(16, 0.34, 0.62);
        spawnOverheadFlutter(18);
      }

      context.clearRect(0, 0, viewportWidth, viewportHeight);

      for (let index = particles.length - 1; index >= 0; index--) {
        const particle = particles[index]!;
        particle.age += deltaSeconds;
        if (particle.age >= particle.lifetime || particle.y > viewportHeight + 48) {
          particles.splice(index, 1);
          continue;
        }

        const dragFactor = Math.exp(-particle.dragRate * deltaSeconds);
        particle.velocityX *= dragFactor;
        particle.velocityY *= dragFactor;

        const flatness = Math.abs(Math.cos(particle.tiltAngle));
        const effectiveGravity = particle.gravity * (0.68 + 0.32 * (1 - flatness));
        particle.velocityY = Math.min(
          particle.terminalVelocity,
          particle.velocityY + effectiveGravity * deltaSeconds,
        );

        particle.wobblePhase += particle.wobbleSpeed * deltaSeconds;
        const flutterVelocityX =
          Math.sin(particle.wobblePhase) * particle.flutterStrength +
          Math.sin(particle.tiltAngle * 2) * particle.flutterStrength * 0.45;

        particle.x += (particle.velocityX + flutterVelocityX) * deltaSeconds;
        particle.y += particle.velocityY * deltaSeconds;
        particle.spinAngle += particle.spinVelocity * deltaSeconds;
        particle.tiltAngle += particle.tiltVelocity * deltaSeconds;

        drawConfettiParticle(context, particle);
      }

      if (particles.length > 0 || !secondaryWaveSpawned) {
        animationFrameId = window.requestAnimationFrame(step);
      } else {
        context.clearRect(0, 0, viewportWidth, viewportHeight);
        setState("complete");
      }
    };

    step(performance.now());

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [winnerColor]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-confetti-state={state}
      className="confetti-layer"
    />
  );
}

export function DiceChart({
  diceCounts,
  compact = false,
  highlightedNumber,
}: {
  diceCounts: readonly number[];
  compact?: boolean;
  highlightedNumber?: number;
}) {
  const translateText = useTranslation(appTranslations);
  const highest = Math.max(1, ...diceCounts);
  return (
    <figure
      className={compact ? "shared-dice-chart" : "mt-5 rounded-xl bg-moss/60 p-3.5"}
      aria-label={translateText("Dice rolls")}
    >
      <figcaption className={compact ? "sr-only" : "text-xs font-semibold uppercase tracking-[.08em] text-muted"}>
        {translateText("Dice rolls")}
      </figcaption>
      <div className={compact ? "victory-dice shared-dice-bars" : "victory-dice mt-2.5"}>
        {diceCounts.map((count, index) => {
          const number = index + 2;
          const highlighted = highlightedNumber === number;
          return (
            <div
              key={number}
              className={`victory-die-column${highlighted ? " shared-die-highlighted" : ""}`}
              role="img"
              aria-label={translateText("{number} appeared {count} times", { number, count })}
            >
              <span className="victory-die-count tabular-nums">{count}</span>
              <span className="victory-die-track">
                {count > 0 && (
                  <span
                    className="victory-die-fill"
                    style={{ height: `${(count / highest) * 100}%`, "--die-index": index } as CSSProperties}
                  />
                )}
              </span>
              <span className="victory-die-number tabular-nums">{number}</span>
            </div>
          );
        })}
      </div>
    </figure>
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
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]"><LongestRoadAwardIcon /></span>
    ))
    .with("largest-army", () => (
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]">
        <LargestArmyIcon />
      </span>
    ))
    .with("master-saboteur", () => (
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]">
        <MasterSaboteurAwardIcon />
      </span>
    ))
    .with("islands", () => (
      <span className="victory-chip bg-[#b58a2d]/15 text-[#b58a2d]"><IslandIcon /></span>
    ))
    .with("victory-point-cards", () => (
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
  diceCounts,
  profileNote,
  mapCode,
  children,
}: {
  eyebrow: string;
  headline: string;
  winnerName: string;
  winnerColor: string;
  totalPoints: number;
  pointsUnit: string;
  summary?: string;
  breakdown: readonly VictoryBreakdownRow[];
  diceCounts?: readonly number[];
  profileNote?: string;
  mapCode?: string;
  children: ReactNode;
}) {
  const translateText = useTranslation(appTranslations);
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | undefined>(undefined);
  const badgeCode = mapCode != null && eyebrow.includes(mapCode) ? mapCode : null;
  const eyebrowParts = badgeCode != null ? eyebrow.split(badgeCode) : null;
  return (
    <div
      className="victory-overlay fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={headline}
    >
      <div className="victory-card panel my-auto w-full max-w-md shrink-0 p-6 text-center sm:p-8">
        <div className="victory-stagger text-left">
          <p className="eyebrow">
            {eyebrowParts && badgeCode != null ? (
              <>
                {eyebrowParts[0]}
                <button
                  type="button"
                  className="victory-map-code mx-1 inline-flex items-center gap-1.5 rounded-full border border-[#e3d3a8] bg-gradient-to-b from-[#fdf7e3] to-[#f3e7c2] px-2.5 py-0.5 align-middle text-[10px] font-bold tracking-[.08em] tabular-nums text-[#8b6425] shadow-[inset_0_1px_0_#fffdf5,0_1px_3px_#423d2814]"
                  aria-label={translateText("Copy map code")}
                  title={translateText(copied ? "Map code copied" : "Copy map code")}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(badgeCode);
                      window.clearTimeout(copyFeedbackTimer.current);
                      setCopied(true);
                      copyFeedbackTimer.current = window.setTimeout(() => setCopied(false), 2_000);
                    } catch {
                      window.clearTimeout(copyFeedbackTimer.current);
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <MapFoldIcon className="h-3.5 w-3.5 shrink-0" />}
                  <span role="status" className="whitespace-nowrap">{copied ? translateText("Copied") : badgeCode}</span>
                </button>
                {eyebrowParts.slice(1).join(badgeCode)}
              </>
            ) : eyebrow}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="victory-emblem relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
              style={{ background: winnerColor, "--winner-color": winnerColor } as CSSProperties}
            >
              {winnerName.charAt(0).toUpperCase()}
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-paper bg-[#f5df9c] text-[#8b6425] shadow-xs">
                <CrownIcon className="h-3 w-3" />
              </span>
            </span>
            <h2 className="min-w-0 font-serif text-2xl leading-tight">{headline}</h2>
          </div>
          <p className="victory-total mt-5 font-serif text-5xl tabular-nums text-[#8b6425]">
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
          {diceCounts != null && diceCounts.some(count => count > 0) && <DiceChart diceCounts={diceCounts} />}
          {summary && <p className="mt-4 text-sm leading-6 text-muted">{summary}</p>}
          {profileNote && (
            <div className="mt-2 space-y-1 text-xs leading-5 text-muted">
              <p>{profileNote}</p>
            </div>
          )}
          <div className="victory-actions mt-6">{children}</div>
        </div>
      </div>
      <Confetti winnerColor={winnerColor} />
    </div>
  );
}
