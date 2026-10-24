import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppDocumentState } from "../mirador/api.ts";
import type { MediaDocument } from "../shared/document.ts";
import { App } from "./App.tsx";
import styles from "./styles.css" with { type: "text" };

/** The panel tells a canvas frame its light or dark theme, which a sandboxed frame doesn't inherit. */
function followThePanelsTheme() {
  addEventListener("message", ({ data }) => {
    if (data?.source === "mirador-canvas" && data.kind === "theme") document.documentElement.style.colorScheme = data.theme === "dark" ? "dark" : "light";
  });
}

function Root() {
  const [state, setState] = useState<AppDocumentState<MediaDocument> | null>(null);
  useEffect(() => window.mirador.onState((next) => setState(next as AppDocumentState<MediaDocument>)), []);
  return state && <App state={state} />;
}

followThePanelsTheme();
document.head.append(Object.assign(document.createElement("style"), { textContent: styles }));
const root = document.body.appendChild(document.createElement("div"));
createRoot(root).render(<Root />);
