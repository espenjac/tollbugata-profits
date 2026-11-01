import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AuthProvider } from "./lib/AuthContext";
import "./index.css";

const storedRedirect = (() => {
  try {
    return window.sessionStorage.getItem("tp-spa-redirect");
  } catch {
    return null;
  }
})();

if (storedRedirect && storedRedirect.startsWith("/")) {
  try {
    window.sessionStorage.removeItem("tp-spa-redirect");
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.history.replaceState(null, "", `${base}${storedRedirect}`);
  } catch {
    // Ignore storage/history failures; the router falls back to "/".
  }
}

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
