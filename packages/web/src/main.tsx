import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./components/App.tsx";
import { StoreProvider } from "./app/store.tsx";
import "./styles.css";

/**
 * Client entry point.
 *
 * The service worker is registered with automatic updates: a new build is
 * picked up on the next load. Data is never at risk from an update,
 * because the replica lives in IndexedDB rather than in the cache.
 */

const container = document.getElementById("root");
if (container === null) {
  throw new Error("The #root element is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

registerSW({ immediate: true });

/**
 * The feedback toolbar, for working on the interface.
 *
 * A person clicks an element of the running application and writes what is
 * wrong with it; the note names the element exactly enough to find the
 * code. It is a development tool: the toolbar is not shipped to the
 * school, because the client is downloaded over a school's network and
 * every kilobyte of it is paid for twice.
 *
 * A build can ask for it with `VITE_AGENTATION=1`, which is how the
 * toolbar is used against the built client rather than the development
 * server.
 */
if (import.meta.env.DEV || import.meta.env.VITE_AGENTATION === "1") {
  void import("./dev/agentation.tsx").then((module) => module.mountAgentation());
}
