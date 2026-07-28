import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ModuleProvider } from "./app/ModuleContext";
import { DataProvider } from "./store/DataContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ModuleProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </ModuleProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
