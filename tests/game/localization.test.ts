import { describe, expect, test } from "bun:test";
import { detectLanguage, pieceName, resourceName, translate } from "../../src/i18n";
import { appTranslations } from "../../src/translations/app";
import { boardTranslations, themeTranslations } from "../../src/translations/board";
import { gameplayTranslations } from "../../src/translations/gameplay";
import { helpTranslations } from "../../src/translations/help";
import { multiplayerUiTranslations } from "../../src/translations/multiplayer-ui";
import { HostRoom } from "../../src/multiplayer/state";

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
