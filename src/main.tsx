import { installPushNavigation } from "./notifications/pushNavigation";
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

installPushNavigation();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ModuleProvider>
          <NotificationProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </NotificationProvider>
        </ModuleProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
