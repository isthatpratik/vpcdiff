import "../styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../shared/theme.tsx";
import { Landing } from "./Landing.tsx";

initTheme("dark");
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
