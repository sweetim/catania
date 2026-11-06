import { describe, expect, test } from "bun:test";
import {
  ACTIVE_PROFILE_STORAGE_KEY, activeProfile, createProfile, PROFILES_STORAGE_KEY, profileStats,
  readProfileState, recordGameResult, recordGameResultForActive, removeProfile, validProfileName, writeProfileState,
  type PlayerProfile, type ProfileGameResult, type ProfileStorage,
} from "../../src/profile";

function memoryStorage(initial: Record<string, string> = {}): ProfileStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

const profile = (overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id: "profile-1", name: "Ada", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null, history: [], ...overrides,
});

const gameResult = (overrides: Partial<ProfileGameResult> = {}): ProfileGameResult => ({
  gameId: "game-1", mapCode: "ABCDEFGH", variant: "original", won: true, points: 10, turnCount: 27, ...overrides,
});

describe("player profile storage", () => {
  test("round-trips profiles and the active selection", () => {
    const storage = memoryStorage();
    expect(readProfileState(storage)).toEqual({ profiles: [], activeId: null });
    const state = { profiles: [profile(), profile({ id: "profile-2", name: "Grace" })], activeId: "profile-2" };
    expect(writeProfileState(state, storage)).toBe(true);
    expect(readProfileState(storage)).toEqual(state);
    expect(activeProfile(readProfileState(storage))!.name).toBe("Grace");
    writeProfileState({ profiles: state.profiles, activeId: null }, storage);
    expect(activeProfile(readProfileState(storage))).toBeNull();
  });

  test("migrates the former anonymous profile once and clears the legacy key on write", () => {
    const storage = memoryStorage({
      "catania.profile": JSON.stringify({ games: 3, wins: 1, totalPoints: 27, lastRecordedGameId: "game-3" }),
    });
    const migrated = readProfileState(storage);
    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.profiles[0]).toMatchObject({ name: "Player", games: 3, wins: 1, totalPoints: 27 });
    expect(migrated.activeId).toBeNull();
    writeProfileState({ profiles: migrated.profiles, activeId: migrated.profiles[0]!.id }, storage);
    expect(storage.getItem("catania.profile")).toBeNull();
    expect(readProfileState(storage).activeId).toBe(migrated.profiles[0]!.id);
  });

  test("removing an inactive profile preserves the active profile and its history", () => {
    const current = recordGameResult(profile(), gameResult());
    const other = profile({ id: "profile-2", name: "Grace" });
    const state = { profiles: [current, other], activeId: current.id };
    const next = removeProfile(state, other.id);
    expect(next).toEqual({ profiles: [current], activeId: current.id });
    expect(state.profiles).toEqual([current, other]);
    const storage = memoryStorage();
    expect(writeProfileState(next, storage)).toBe(true);
    expect(readProfileState(storage)).toEqual(next);
  });

  test("removing the active or last profile clears selection without selecting a replacement", () => {
    const first = profile();
    const second = profile({ id: "profile-2", name: "Grace" });
    const next = removeProfile({ profiles: [first, second], activeId: first.id }, first.id);
    expect(next).toEqual({ profiles: [second], activeId: null });
    expect(activeProfile(next)).toBeNull();
    const storage = memoryStorage({ [ACTIVE_PROFILE_STORAGE_KEY]: first.id });
    expect(writeProfileState(next, storage)).toBe(true);
    expect(storage.getItem(ACTIVE_PROFILE_STORAGE_KEY)).toBeNull();
    expect(removeProfile(next, second.id)).toEqual({ profiles: [], activeId: null });
  });

  test.each([
    ["not-json", "null"],
    ["[]", "[{}]"],
    [JSON.stringify([{ id: "profile-1", name: "Ada", games: -1, wins: 0, totalPoints: 0, lastRecordedGameId: null }]), "x"],
    [JSON.stringify([{ id: "", name: "Ada", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null }]), "x"],
    [JSON.stringify([{ id: "profile-1", name: "  ", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null }]), "x"],
    [JSON.stringify([{ id: "profile-1", name: "Ada", games: 1.5, wins: 0, totalPoints: 0, lastRecordedGameId: null }]), "x"],
    [JSON.stringify([{ id: "profile-1", name: "Ada", games: 1, wins: 0, totalPoints: 0, lastRecordedGameId: 7 }]), "x"],
  ])("drops corrupted list %j", raw => {
    const state = readProfileState(memoryStorage({ [PROFILES_STORAGE_KEY]: raw }));
    expect(state).toEqual({ profiles: [], activeId: null });
  });

  test("an active id without a matching profile selects nothing", () => {
    const storage = memoryStorage({
      [PROFILES_STORAGE_KEY]: JSON.stringify([profile()]),
      [ACTIVE_PROFILE_STORAGE_KEY]: "missing",
    });
    expect(readProfileState(storage).activeId).toBeNull();
  });

  test("old profiles preserve lifetime totals and start with empty history", () => {
    const storage = memoryStorage({
      [PROFILES_STORAGE_KEY]: JSON.stringify([{
        id: "profile-1", name: "Ada", games: 8, wins: 2, totalPoints: 61, lastRecordedGameId: "old-game",
      }]),
      [ACTIVE_PROFILE_STORAGE_KEY]: "profile-1",
    });
    expect(activeProfile(readProfileState(storage))).toEqual(profile({
      games: 8, wins: 2, totalPoints: 61, lastRecordedGameId: "old-game",
    }));
  });

  test.each([
    null,
    { gameId: "" },
    { mapCode: "invalid" },
    { variant: "unknown" },
    { points: -1 },
    { turnCount: 1.5 },
    { completedAt: "not-a-date" },
  ])("ignores malformed history entries without losing the profile: %j", invalid => {
    const entry = { ...gameResult(), completedAt: "2026-11-06T00:00:00.000Z" };
    const storage = memoryStorage({
      [PROFILES_STORAGE_KEY]: JSON.stringify([{ ...profile({ games: 4 }), history: [entry, invalid && { ...entry, ...invalid }] }]),
    });
    expect(readProfileState(storage).profiles[0]).toEqual(profile({ games: 4, history: [entry] }));
  });

  test("profile names normalize and validate like seat names", () => {
    expect(validProfileName(" Ada ")).toBe(true);
    expect(validProfileName("a".repeat(21))).toBe(false);
    expect(validProfileName("Ada\n")).toBe(false);
    expect(validProfileName("")).toBe(false);
    expect(createProfile(" Grace ").name).toBe("Grace");
    expect(createProfile("Grace").id).not.toBe(createProfile("Grace").id);
  });
});

describe("recording finished games", () => {
  test("accumulates games, wins and points, and never counts one game twice", () => {
    const first = recordGameResult(profile(), gameResult());
    expect(first).toEqual({
      ...profile({ games: 1, wins: 1, totalPoints: 10 }), lastRecordedGameId: "game-1",
      history: [{ ...gameResult(), completedAt: expect.any(String) }],
    });
    expect(Number.isFinite(Date.parse(first.history[0]!.completedAt))).toBe(true);
    expect(recordGameResult(first, gameResult())).toBe(first);
    const secondResult = gameResult({ gameId: "game-2", won: false, points: 7, variant: "seafarers" });
    const second = recordGameResult(first, secondResult);
    expect(second).toEqual({
      ...profile({ games: 2, wins: 1, totalPoints: 17 }), lastRecordedGameId: "game-2",
      history: [{ ...secondResult, completedAt: expect.any(String) }, ...first.history],
    });
    expect(recordGameResult(second, gameResult())).toBe(second);
    expect(profileStats(second)).toEqual({ games: 2, wins: 1, totalPoints: 17 });
  });

  test("recording targets the selected profile only and persists the whole list", () => {
    const storage = memoryStorage();
    writeProfileState({ profiles: [profile(), profile({ id: "profile-2", name: "Grace" })], activeId: "profile-2" }, storage);
    expect(recordGameResultForActive(gameResult(), storage)).toMatchObject({ name: "Grace", games: 1 });
    expect(recordGameResultForActive(gameResult(), storage)!.games).toBe(1);
    expect(recordGameResultForActive(gameResult({ gameId: "game-2", won: false, points: 5 }), storage)).toMatchObject({ name: "Grace", games: 2, wins: 1 });
    const state = readProfileState(storage);
    expect(state.profiles.find(candidate => candidate.id === "profile-1")!.games).toBe(0);
    expect(state.profiles.find(candidate => candidate.id === "profile-2")!.games).toBe(2);
    expect(state.profiles.find(candidate => candidate.id === "profile-2")!.history.map(game => game.gameId)).toEqual(["game-2", "game-1"]);
    expect(recordGameResultForActive(gameResult(), storage)!.games).toBe(2);
  });

  test("without a selected profile nothing records or changes", () => {
    const storage = memoryStorage();
    writeProfileState({ profiles: [profile()], activeId: null }, storage);
    expect(recordGameResultForActive(gameResult(), storage)).toBeNull();
    expect(readProfileState(storage).profiles[0]!.games).toBe(0);
  });

  test("reports a storage write failure rather than claiming history was saved", () => {
    const storage = memoryStorage();
    expect(writeProfileState({ profiles: [profile()], activeId: "profile-1" }, null)).toBe(false);
    writeProfileState({ profiles: [profile()], activeId: "profile-1" }, storage);
    expect(() => recordGameResultForActive(gameResult(), {
      ...storage,
      setItem() { throw new DOMException("Storage full", "QuotaExceededError"); },
    })).toThrow("Your game history could not be saved on this device.");
    expect(readProfileState(storage).profiles[0]!.history).toEqual([]);
  });
});
