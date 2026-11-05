import { describe, expect, test } from "bun:test";
import {
  ACTIVE_PROFILE_STORAGE_KEY, activeProfile, createProfile, PROFILES_STORAGE_KEY, profileStats,
  readProfileState, recordGameResult, recordGameResultForActive, validProfileName, writeProfileState,
  type PlayerProfile, type ProfileStorage,
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
  id: "profile-1", name: "Ada", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null, ...overrides,
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
    const first = recordGameResult(profile(), { gameId: "game-1", won: true, points: 10 });
    expect(first).toEqual({ ...profile({ games: 1, wins: 1, totalPoints: 10 }), lastRecordedGameId: "game-1" });
    expect(recordGameResult(first, { gameId: "game-1", won: true, points: 10 })).toBe(first);
    const second = recordGameResult(first, { gameId: "game-2", won: false, points: 7 });
    expect(second).toEqual({ ...profile({ games: 2, wins: 1, totalPoints: 17 }), lastRecordedGameId: "game-2" });
    expect(profileStats(second)).toEqual({ games: 2, wins: 1, totalPoints: 17 });
  });

  test("recording targets the selected profile only and persists the whole list", () => {
    const storage = memoryStorage();
    writeProfileState({ profiles: [profile(), profile({ id: "profile-2", name: "Grace" })], activeId: "profile-2" }, storage);
    expect(recordGameResultForActive({ gameId: "game-1", won: true, points: 10 }, storage)).toMatchObject({ name: "Grace", games: 1 });
    expect(recordGameResultForActive({ gameId: "game-1", won: true, points: 10 }, storage)!.games).toBe(1);
    expect(recordGameResultForActive({ gameId: "game-2", won: false, points: 5 }, storage)).toMatchObject({ name: "Grace", games: 2, wins: 1 });
    const state = readProfileState(storage);
    expect(state.profiles.find(candidate => candidate.id === "profile-1")!.games).toBe(0);
    expect(state.profiles.find(candidate => candidate.id === "profile-2")!.games).toBe(2);
  });

  test("without a selected profile nothing records or changes", () => {
    const storage = memoryStorage();
    writeProfileState({ profiles: [profile()], activeId: null }, storage);
    expect(recordGameResultForActive({ gameId: "game-1", won: true, points: 10 }, storage)).toBeNull();
    expect(readProfileState(storage).profiles[0]!.games).toBe(0);
  });
});
