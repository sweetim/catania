import { describe, expect, test } from "bun:test";
import { detectLanguage, pieceName, resourceName, translate } from "../../src/i18n";
import { appTranslations } from "../../src/translations/app";
import { boardTranslations, themeTranslations } from "../../src/translations/board";
import { gameplayTranslations } from "../../src/translations/gameplay";
import { helpTranslations } from "../../src/translations/help";
import { multiplayerUiTranslations } from "../../src/translations/multiplayer-ui";
import { HostRoom } from "../../src/multiplayer/state";
import { getPhaseInstructions } from "../../src/components/TurnInstructions";
import { getDevelopmentDescriptions } from "../../src/components/GameplayDialogs";

describe("language selection", () => {
  test("uses the first supported browser language, including regional locales", () => {
    expect(detectLanguage(["ja-JP", "en-US"])).toBe("ja");
    expect(detectLanguage(["ja"])).toBe("ja");
    expect(detectLanguage(["JA-jp"])).toBe("ja");
    expect(detectLanguage(["en-GB", "ja-JP"])).toBe("en");
    expect(detectLanguage(["fr-FR", "ja-JP", "en"])).toBe("ja");
  });

  test("falls back to English for unsupported or missing browser languages", () => {
    expect(detectLanguage(["fr-FR", "de-DE"])).toBe("en");
    expect(detectLanguage(["jp"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });

  test("computer defaults follow the host language and avoid existing or pending names", () => {
    const room = new HostRoom("language-test");
    room.addComputer("ja");
    expect(room.snapshot().players[0]!.name).toBe("コンピューター1");
    room.join("pending", { type: "join", name: "コンピューター2", secret: "language-test" });
    room.addComputer("ja");
    expect(room.snapshot().players[1]!.name).toBe("コンピューター3");
    room.renameComputer(room.snapshot().players[0]!.id, "Rover");
    room.addComputer("en");
    expect(room.snapshot().players.map(player => player.name)).toEqual(["Rover", "コンピューター3", "Computer 1"]);
  });
});

describe("translations", () => {
  test.each(["en", "ja"] as const)("Foggy World explains direct second settlements and route choices in %s", language => {
    const secondSettlement = getPhaseInstructions({
      phase: { type: "setup-reveal" }, secondSettlement: true, variant: "foggy-world", language,
    });
    expect(secondSettlement.title).toBe(language === "en" ? "Place your second settlement." : "2つ目の開拓地を配置しましょう。");
    expect(secondSettlement.description).toContain(language === "en" ? "directly" : "直接");
    for (const tileId of [undefined, "tile-1"]) {
      const route = getPhaseInstructions({
        phase: { type: "setup-road", vertexId: "vertex-1", ...(tileId ? { tileId } : {}) },
        secondSettlement: true, variant: "foggy-world", language,
      });
      expect(route.description).toContain(language === "en" ? "Choose Road or Ship first" : "まず街道か船を選び");
      expect(route.description).toContain(language === "en"
        ? tileId ? "selected cell" : "revealed land"
        : tileId ? "選んだタイル" : "公開済みの陸地");
    }
  });

  test.each([3, 13])("custom %s-point games show the selected target in finished-turn instructions", points => {
    const options = { phase: { type: "finished" }, secondSettlement: false, victoryPointsToWin: points } as const;
    expect(getPhaseInstructions({ ...options, language: "en" }).description)
      .toBe(`The first player to reach ${points} victory points on their turn wins.`);
    expect(getPhaseInstructions({ ...options, language: "ja" }).description)
      .toBe(`自分の手番に先に${points}勝利点に到達したプレイヤーが勝利します。`);
    expect(getDevelopmentDescriptions("en", "original", points)["victory-point"])
      .toBe("One hidden victory point. Counts automatically toward victory on your turn, including when purchased.");
  });

  const messages = { "{player} receives {count} cards.": "{player}はカードを{count}枚受け取ります。" };

  test("keeps English text and interpolates whole Japanese sentences", () => {
    expect(translate("en", messages, "{player} receives {count} cards.", { player: "Alex", count: 2 }))
      .toBe("Alex receives 2 cards.");
    expect(translate("ja", messages, "{player} receives {count} cards.", { player: "太郎", count: 2 }))
      .toBe("太郎はカードを2枚受け取ります。");
  });

  test("does not interpret player names as translation templates", () => {
    expect(translate("ja", messages, "{player} receives {count} cards.", { player: "{count} $&", count: 0 }))
      .toBe("{count} $&はカードを0枚受け取ります。");
  });

  test("localizes resource and piece labels without changing identifiers", () => {
    expect(resourceName("en", "wood")).toBe("Wood");
    expect(resourceName("ja", "wood")).toBe("木材");
    expect(resourceName("ja", "brick")).toBe("レンガ");
    expect(pieceName("en", "settlement")).toBe("settlement");
    expect(pieceName("ja", "settlement")).toBe("開拓地");
  });

  test("every Japanese UI catalog entry retains all template parameters", () => {
    for (const catalog of [appTranslations, boardTranslations, themeTranslations, gameplayTranslations, helpTranslations, multiplayerUiTranslations]) {
      for (const [english, japanese] of Object.entries(catalog)) {
        const parameters = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
        expect(japanese.trim(), english).not.toBe("");
        expect(parameters(japanese), english).toEqual(parameters(english));
      }
    }
  });
});
