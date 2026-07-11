import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/sora/wght.css";
import "@mantine/charts/styles.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles/app.css";
import "./styles/workbench.css";
import "./styles/v2.css";
import "./styles/trace-workspaces.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
