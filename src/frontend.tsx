/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MultiplayerApp } from "./multiplayer/MultiplayerApp";
import { LanguageProvider } from "./localization";
import { setupPwa } from "./pwa";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <LanguageProvider>
      {new URLSearchParams(window.location.search).has("multiplayer") ? <MultiplayerApp /> : <App />}
    </LanguageProvider>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);

setupPwa();
