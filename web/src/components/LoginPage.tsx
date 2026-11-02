import { useState } from "react";
import { useAuth } from "../lib/auth-context";
import { InlineNotice, LoadingView } from "./ui";

export function LoginPage() {
  const { signInWithGoogle, configured } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <div className="auth-shell">
        <div className="auth-card panel">
          <h1>Mangler Supabase-konfigurasjon</h1>
          <p>
            Legg inn <code>VITE_SUPABASE_URL</code> og{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> i miljøvariablene før bygg.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card panel">
        <img
          className="auth-logo"
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt=""
          width={72}
          height={72}
        />
        <p className="eyebrow">Pre-market · Oslo Børs</p>
        <h1>Tollbugata Profits</h1>
        <p className="auth-lead">
          Teknisk screening, nyhetsvurdering og manuell handelsplan for Oslo
          Børs. Rapporten lages når appen åpnes, og alle handler registreres
          manuelt.
        </p>
        {busy ? (
          <LoadingView message="Sender deg til Google …" />
        ) : (
          <button
            className="btn btn-google"
            type="button"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await signInWithGoogle();
              } catch (signInError) {
                setError(
                  signInError instanceof Error
                    ? signInError.message
                    : String(signInError),
                );
                setBusy(false);
              }
            }}
          >
            <span className="google-mark" aria-hidden="true">
              G
            </span>
            Logg inn med Google
          </button>
        )}
        {error ? (
          <InlineNotice kind="error">
            Kunne ikke starte innlogging: {error}
          </InlineNotice>
        ) : null}
        <p className="auth-footnote">
          Appen er for inviterte brukere. Ta kontakt med eieren hvis du mangler
          tilgang.
        </p>
        <p className="disclaimer">
          Appen sender aldri ordrer. Den er et beslutningsstøtteverktøy, ikke
          investeringsrådgivning.
        </p>
      </div>
    </div>
  );
}
