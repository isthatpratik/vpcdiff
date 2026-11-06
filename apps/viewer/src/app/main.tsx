import "@xyflow/react/dist/style.css";
import "../styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../shared/theme.tsx";
import { App } from "./App.tsx";

initTheme();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
