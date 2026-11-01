import { useEffect, useState, type ReactNode } from "react";

export function LoadingView({ message = "Laster …" }: { message?: string }) {
  return (
    <div className="loading-view" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function ErrorPanel({
  title = "Noe gikk galt",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <section className="panel error-panel" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="btn btn-primary" type="button" onClick={onRetry}>
          Prøv igjen
        </button>
      ) : null}
    </section>
  );
}

export function InlineNotice({
  kind = "info",
  children,
}: {
  kind?: "info" | "warning" | "error" | "success";
  children: ReactNode;
}) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function InstallBanner() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("tp-install-dismissed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!prompt || dismissed) {
    return null;
  }

  return (
    <div className="install-banner">
      <div>
        <strong>Installer Tollbugata Profits</strong>
        <span>Få appen på hjemskjermen og åpne den som en vanlig app.</span>
      </div>
      <div className="install-actions">
        <button
          className="btn btn-primary btn-small"
          type="button"
          onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") {
              setPrompt(null);
            }
          }}
        >
          Installer app
        </button>
        <button
          className="btn btn-ghost btn-small"
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem("tp-install-dismissed", "1");
            } catch {
              // Ignore storage failures; dismissal still applies this session.
            }
            setDismissed(true);
          }}
        >
          Ikke nå
        </button>
      </div>
    </div>
  );
}

export function OnlineBadge() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <span className={`online-badge ${online ? "online" : "offline"}`}>
      <span aria-hidden="true" />
      {online ? "Tilkoblet" : "Frakoblet"}
    </span>
  );
}

export function SentimentBadge({ sentiment }: { sentiment: string }) {
  const labels: Record<string, string> = {
    positive: "Positiv",
    negative: "Negativ",
    neutral: "Nøytral",
    mixed: "Blandet",
  };
  return (
    <span className={`sentiment sentiment-${sentiment}`}>
      {labels[sentiment] ?? sentiment}
    </span>
  );
}

export function CategoryChips({ categories }: { categories: string[] }) {
  const labels: Record<string, string> = {
    momentum: "Momentum",
    breakout: "Breakout",
    news: "Nyhetsdrevet",
  };
  return (
    <div className="chips">
      {categories.map((category) => (
        <span className="chip" key={category}>
          {labels[category] ?? category}
        </span>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className={`stat-card${tone ? ` tone-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
