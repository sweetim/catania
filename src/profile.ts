import { normalizeMapSeed } from "./game/board";
import { GameError } from "./game/messages";
import { isGameVariant, type GameVariant } from "./game/types";

export type ProfileStats = { games: number; wins: number; totalPoints: number };
export type ProfileGameResult = {
  gameId: string;
  mapCode: string;
  variant: GameVariant;
  won: boolean;
  points: number;
  turnCount: number;
};
export type ProfileGame = ProfileGameResult & { completedAt: string };
export type PlayerProfile = ProfileStats & { id: string; name: string; lastRecordedGameId: string | null; history: ProfileGame[] };

export const PROFILES_STORAGE_KEY = "catania.profiles";
export const ACTIVE_PROFILE_STORAGE_KEY = "catania.profile.active";
const LEGACY_PROFILE_STORAGE_KEY = "catania.profile";

export type ProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ProfileState = { profiles: PlayerProfile[]; activeId: string | null };

function browserStorage(): ProfileStorage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function historyFrom(value: unknown): ProfileGame | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.gameId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.gameId) ||
    typeof candidate.mapCode !== "string" || !normalizeMapSeed(candidate.mapCode) ||
    !isGameVariant(candidate.variant) ||
    typeof candidate.won !== "boolean" || !count(candidate.points) || !count(candidate.turnCount) ||
    typeof candidate.completedAt !== "string" || !Number.isFinite(Date.parse(candidate.completedAt))) return null;
  return {
    gameId: candidate.gameId,
    mapCode: normalizeMapSeed(candidate.mapCode)!,
    variant: candidate.variant,
    won: candidate.won,
    points: candidate.points,
    turnCount: candidate.turnCount,
    completedAt: candidate.completedAt,
  };
}

export function validProfileName(value: unknown): value is string {
  return typeof value === "string" && [...value.trim().normalize("NFC")].length >= 1 &&
    [...value.trim().normalize("NFC")].length <= 20 && !/\p{C}/u.test(value);
}

function profileFrom(value: unknown): PlayerProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id)) return null;
  if (!validProfileName(candidate.name)) return null;
  if (!count(candidate.games) || !count(candidate.wins) || !count(candidate.totalPoints)) return null;
  if (candidate.lastRecordedGameId !== null && typeof candidate.lastRecordedGameId !== "string") return null;
  return {
    id: candidate.id,
    name: candidate.name.trim().normalize("NFC"),
    games: candidate.games,
    wins: candidate.wins,
    totalPoints: candidate.totalPoints,
    lastRecordedGameId: candidate.lastRecordedGameId ?? null,
    history: Array.isArray(candidate.history)
      ? candidate.history.map(historyFrom).filter((entry): entry is ProfileGame => entry !== null)
      : [],
  };
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Reads all device profiles and the selected one, migrating the former single-profile format once. */
export function readProfileState(storage: ProfileStorage | null = browserStorage()): ProfileState {
  let rawProfiles: string | null = null;
  let rawActive: string | null = null;
  let legacy: string | null = null;
  try {
    rawProfiles = storage?.getItem(PROFILES_STORAGE_KEY) ?? null;
    rawActive = storage?.getItem(ACTIVE_PROFILE_STORAGE_KEY) ?? null;
    legacy = storage?.getItem(LEGACY_PROFILE_STORAGE_KEY) ?? null;
  } catch {
    return { profiles: [], activeId: null };
  }
  let profiles: PlayerProfile[] = [];
  const parsed = parse(rawProfiles);
  if (Array.isArray(parsed)) {
    profiles = parsed.map(profileFrom).filter((profile): profile is PlayerProfile => profile !== null);
  } else if (legacy !== null) {
    // The pre-profile release stored one anonymous record; it becomes a profile named "Player".
    const migrated = profileFrom({ ...parse(legacy) as object, id: crypto.randomUUID(), name: "Player" });
    if (migrated) profiles = [migrated];
  }
  const activeId = profiles.some(profile => profile.id === rawActive) ? rawActive : null;
  return { profiles, activeId };
}

export function writeProfileState(state: ProfileState, storage: ProfileStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage?.setItem(PROFILES_STORAGE_KEY, JSON.stringify(state.profiles));
    if (state.activeId === null) storage?.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
    else storage?.setItem(ACTIVE_PROFILE_STORAGE_KEY, state.activeId);
    storage?.removeItem(LEGACY_PROFILE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function createProfile(name: string): PlayerProfile {
  return { id: crypto.randomUUID(), name: name.trim().normalize("NFC"), games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null, history: [] };
}

export function activeProfile(state: ProfileState): PlayerProfile | null {
  return state.profiles.find(profile => profile.id === state.activeId) ?? null;
}

export function removeProfile(state: ProfileState, profileId: string): ProfileState {
  return {
    profiles: state.profiles.filter(profile => profile.id !== profileId),
    activeId: state.activeId === profileId ? null : state.activeId,
  };
}

/** Records one finished game. Re-recording the same game (reconnect or reload) never counts twice. */
export function recordGameResult(profile: PlayerProfile, result: ProfileGameResult): PlayerProfile {
  if (profile.lastRecordedGameId === result.gameId || profile.history.some(entry => entry.gameId === result.gameId)) return profile;
  return {
    ...profile,
    games: profile.games + 1,
    wins: profile.wins + (result.won ? 1 : 0),
    totalPoints: profile.totalPoints + result.points,
    lastRecordedGameId: result.gameId,
    history: [{ ...result, completedAt: new Date().toISOString() }, ...profile.history],
  };
}

export function profileStats(profile: PlayerProfile): ProfileStats {
  return { games: profile.games, wins: profile.wins, totalPoints: profile.totalPoints };
}

/** Records into the selected profile and persists the list; null when no profile is active. */
export function recordGameResultForActive(
  result: ProfileGameResult,
  storage: ProfileStorage | null = browserStorage(),
): PlayerProfile | null {
  const state = readProfileState(storage);
  const current = activeProfile(state);
  if (!current) return null;
  const updated = recordGameResult(current, result);
  if (updated !== current) {
    if (!writeProfileState({ profiles: state.profiles.map(profile => profile === current ? updated : profile), activeId: state.activeId }, storage)) {
      throw new GameError("Your game history could not be saved on this device.");
    }
  }
  return updated;
}
