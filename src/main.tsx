import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./contexts/theme.context";
import { AppProvider } from "./contexts/app.context";
import AppRoutes from "./routes";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </ThemeProvider>
  </React.StrictMode>
);
