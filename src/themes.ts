import { createContext, useContext } from "react";
import type { Resource, Terrain } from "./game/types";
import { translate, type Language } from "./i18n";
import { themeTranslations } from "./translations/board";

export type BoardThemeId = "illustrated" | "ceramic" | "wooden" | "pixel" | "space" | "underwater";

export type BoardTheme = {
  id: BoardThemeId;
  name: string;
  description: string;
  terrain: Record<Terrain, { fill: string; ink: string; label: string }>;
  resources: Record<Resource, string>;
  sea: [string, string, string];
  surface: string;
  coast: string;
  border: string;
};

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  illustrated: {
    id: "illustrated",
    name: "Illustrated Island",
    description: "Soft hills, inked forests, and a quiet green sea.",
    terrain: {
      wood: { fill: "#8fa58a", ink: "#365747", label: "Forest" },
      brick: { fill: "#cb947b", ink: "#8b4f3e", label: "Hills" },
      wool: { fill: "#bdc695", ink: "#64734a", label: "Pasture" },
      grain: { fill: "#dfc680", ink: "#9c7938", label: "Fields" },
      ore: { fill: "#a7b6b4", ink: "#536a6e", label: "Mountains" },
      desert: { fill: "#dec49b", ink: "#ab8556", label: "Desert" },
      sea: { fill: "#a8c8bc", ink: "#365747", label: "Sea" },
      gold: { fill: "#e5bf61", ink: "#805c20", label: "Gold fields" },
    },
    resources: { wood: "#426c4f", brick: "#b96d51", wool: "#8a9c64", grain: "#c6a14b", ore: "#788789" },
    sea: ["#c5dcd0", "#a8c8bc", "#87afa5"],
    surface: "#f4f0e5",
    coast: "#eee2bf",
    border: "#eee5cf",
  },
  ceramic: {
    id: "ceramic",
    name: "Mediterranean Ceramic",
    description: "Cobalt brushwork, leafy glazes, and mosaic edges.",
    terrain: {
      wood: { fill: "#e0ebdf", ink: "#285a72", label: "Forest" },
      brick: { fill: "#efd4bd", ink: "#9c503e", label: "Hills" },
      wool: { fill: "#e8ecd0", ink: "#536b4a", label: "Pasture" },
      grain: { fill: "#f6e5ad", ink: "#90621e", label: "Fields" },
      ore: { fill: "#d9e5ee", ink: "#315c84", label: "Mountains" },
      desert: { fill: "#f2e6cf", ink: "#987346", label: "Desert" },
      sea: { fill: "#69acb9", ink: "#285a72", label: "Sea" },
      gold: { fill: "#f1d286", ink: "#90621e", label: "Gold fields" },
    },
    resources: { wood: "#286574", brick: "#b55c43", wool: "#758644", grain: "#bd8a2b", ore: "#38679b" },
    sea: ["#a6d5d7", "#69acb9", "#3b7593"],
    surface: "#f6f0e4",
    coast: "#fbf2d8",
    border: "#faf6eb",
  },
  wooden: {
    id: "wooden",
    name: "Carved Wooden Tabletop",
    description: "Warm timber, cut grain, and hand-engraved details.",
    terrain: {
      wood: { fill: "#a3aa7c", ink: "#414b30", label: "Forest" },
      brick: { fill: "#bf8863", ink: "#683c27", label: "Hills" },
      wool: { fill: "#c6bd8c", ink: "#656039", label: "Pasture" },
      grain: { fill: "#d9b36a", ink: "#78531f", label: "Fields" },
      ore: { fill: "#a49b89", ink: "#4f4b43", label: "Mountains" },
      desert: { fill: "#d8be91", ink: "#896440", label: "Desert" },
      sea: { fill: "#778f81", ink: "#414b30", label: "Sea" },
      gold: { fill: "#d9b36a", ink: "#78531f", label: "Gold fields" },
    },
    resources: { wood: "#59623d", brick: "#935434", wool: "#88834e", grain: "#aa7a31", ore: "#736b5c" },
    sea: ["#9ba999", "#778f81", "#536f65"],
    surface: "#dbc39e",
    coast: "#ead1a0",
    border: "#f0d8ac",
  },
  pixel: {
    id: "pixel",
    name: "Pixel-Art Kingdom",
    description: "Block-built forests, stepped hills, and tiny flocks.",
    terrain: {
      wood: { fill: "#83b787", ink: "#244f38", label: "Forest" },
      brick: { fill: "#d38b73", ink: "#803e3e", label: "Hills" },
      wool: { fill: "#b9d98d", ink: "#4a6c3d", label: "Pasture" },
      grain: { fill: "#f0ce6f", ink: "#92652b", label: "Fields" },
      ore: { fill: "#afb6d1", ink: "#4b527a", label: "Mountains" },
      desert: { fill: "#ecd5a0", ink: "#9b7747", label: "Desert" },
      sea: { fill: "#68a7c6", ink: "#244f38", label: "Sea" },
      gold: { fill: "#f0ce6f", ink: "#92652b", label: "Gold fields" },
    },
    resources: { wood: "#367447", brick: "#ba5a4c", wool: "#7d9e45", grain: "#bd8d2f", ore: "#727ca5" },
    sea: ["#a0d3e2", "#68a7c6", "#4676a3"],
    surface: "#f0e7d0",
    coast: "#fff0b5",
    border: "#f8efd3",
  },
  space: {
    id: "space",
    name: "Space Frontier",
    description: "Orbital farms and mineral outposts on cratered worlds.",
    terrain: {
      wood: { fill: "#a4c6b7", ink: "#285c53", label: "Forest" },
      brick: { fill: "#d3a09c", ink: "#864b59", label: "Hills" },
      wool: { fill: "#c4d0b8", ink: "#506948", label: "Pasture" },
      grain: { fill: "#e3cc92", ink: "#8d6c2d", label: "Fields" },
      ore: { fill: "#b4b4d3", ink: "#555581", label: "Mountains" },
      desert: { fill: "#c7b9b2", ink: "#7a6165", label: "Desert" },
      sea: { fill: "#323e5b", ink: "#b4b4d3", label: "Sea" },
      gold: { fill: "#e3cc92", ink: "#8d6c2d", label: "Gold fields" },
    },
    resources: { wood: "#387f70", brick: "#ae6174", wool: "#80975d", grain: "#b99b42", ore: "#7771aa" },
    sea: ["#505976", "#323e5b", "#202b46"],
    surface: "#e9e9ee",
    coast: "#c8c8dc",
    border: "#e7e5f0",
  },
  underwater: {
    id: "underwater",
    name: "Underwater Colonies",
    description: "Reef-side greenhouses, sea-floor mines, and bubbles.",
    terrain: {
      wood: { fill: "#97c6b0", ink: "#285e52", label: "Forest" },
      brick: { fill: "#e2aaa0", ink: "#9a5255", label: "Hills" },
      wool: { fill: "#c3d3bd", ink: "#547653", label: "Pasture" },
      grain: { fill: "#e5d59c", ink: "#8c7331", label: "Fields" },
      ore: { fill: "#a6c9d5", ink: "#34677e", label: "Mountains" },
      desert: { fill: "#d7ceb5", ink: "#85795b", label: "Desert" },
      sea: { fill: "#4b9fae", ink: "#285e52", label: "Sea" },
      gold: { fill: "#e5d59c", ink: "#8c7331", label: "Gold fields" },
    },
    resources: { wood: "#367c66", brick: "#c17570", wool: "#7f9d71", grain: "#b6a14a", ore: "#508ca3" },
    sea: ["#87cbd0", "#4b9fae", "#276b86"],
    surface: "#e7f1ec",
    coast: "#d5e9d7",
    border: "#e2f2e9",
  },
};

export const BoardThemeContext = createContext<BoardTheme>(BOARD_THEMES.illustrated);

export function getThemeName(theme: BoardTheme, language: Language) {
  return translate(language, themeTranslations, theme.name);
}

export function getThemeDescription(theme: BoardTheme, language: Language) {
  return translate(language, themeTranslations, theme.description);
}

export function getTerrainName(theme: BoardTheme, terrain: Terrain, language: Language) {
  return translate(language, themeTranslations, theme.terrain[terrain].label);
}

export function useBoardTheme() {
  return useContext(BoardThemeContext);
}
