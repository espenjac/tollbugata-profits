import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./components/LoginPage";
import { LoadingView } from "./components/ui";
import { useAuth } from "./lib/auth-context";
import { DashboardPage } from "./pages/DashboardPage";
import { EtradePage } from "./pages/EtradePage";
import { JournalPage } from "./pages/JournalPage";

function routerBasename(): string | undefined {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base === "" ? undefined : base;
}

export default function App() {
  const { user, loading, configured } = useAuth();

  if (!configured) {
    return <LoginPage />;
  }
  if (loading) {
    return (
      <div className="auth-shell">
        <LoadingView message="Sjekker innlogging …" />
      </div>
    );
  }
  if (!user) {
    return <LoginPage />;
  }

  return (
    <BrowserRouter basename={routerBasename()}>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/etrade" element={<EtradePage />} />
          <Route path="/logg" element={<JournalPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
