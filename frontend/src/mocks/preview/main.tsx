import { createRoot } from "react-dom/client";
import { startDevelopmentMock } from "../bootstrap";
import "../../styles/index.css";

const container = document.getElementById("root")!;
if (!import.meta.env.DEV || import.meta.env.VITE_USE_MOCK !== "1") {
  container.textContent = "This development preview requires VITE_USE_MOCK=1 and npm run dev.";
} else {
  void startDevelopmentMock().then(async () => {
    const { PreviewApp } = await import("./PreviewApp");
    createRoot(container).render(<PreviewApp />);
  });
}
