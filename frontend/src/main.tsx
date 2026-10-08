import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app/App";
import { startDevelopmentMock } from "./mocks/bootstrap";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html");

void startDevelopmentMock().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
