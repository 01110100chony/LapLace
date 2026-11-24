import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./styles.css";
import "./work.css";
import "./living-system.css";
import "./preview/preview.css";
import "./shell.css";
import "./graph/graph.css";
import "./studio.css";

createRoot(document.getElementById("root")!).render(<App />);
