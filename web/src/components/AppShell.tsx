import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth-context";
import { InstallBanner, OnlineBadge } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img
            src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
            alt=""
            width={34}
            height={34}
          />
          <span>
            Tollbugata <strong>Profits</strong>
          </span>
        </div>
        <nav className="main-nav" aria-label="Hovedmeny">
          <NavLink to="/" end>
            Kursinformasjon
          </NavLink>
          <NavLink to="/logg">Handelsdagbok</NavLink>
        </nav>
        <div className="topbar-actions">
          <OnlineBadge />
          <span className="user-email" title={user?.email ?? ""}>
            {user?.email}
          </span>
          <button
            className="btn btn-ghost btn-small"
            type="button"
            onClick={() => void signOut()}
          >
            Logg ut
          </button>
        </div>
      </header>
      <InstallBanner />
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <p>
          Tollbugata Profits er et beslutningsstøtteverktøy for manuell handel.
          Ingen ordrer sendes automatisk. Data kan være forsinket eller
          ufullstendig.
        </p>
        <p>
          Rapporten er ikke investeringsrådgivning. Kontroller alltid kurs,
          volum og nyheter før du handler.
        </p>
      </footer>
    </div>
  );
}
