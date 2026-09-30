import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ModuleProvider } from "./app/ModuleContext";
import { DataProvider } from "./store/DataContext";
import { startDeploymentFreshnessMonitor } from "./lib/deploymentFreshness";
import "./styles.css";
import { NotificationProvider } from "./notifications/NotificationProvider";

if (import.meta.env.PROD) startDeploymentFreshnessMonitor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
        <ModuleProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </ModuleProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
