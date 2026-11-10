import { useEffect, useState } from "react";
import { requireSupabase } from "../lib/supabase";

type PushState = "loading" | "off" | "on" | "unsupported" | "setup" | "blocked" | "error";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function saveSubscription(userId: string, subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error("Telefonen returnerte ikke gyldige push-nøkler.");
  }
  const { error } = await requireSupabase()
    .from("sim_push_subscriptions")
    .upsert(
      { user_id: userId, endpoint: subscription.endpoint, p256dh, auth_key: auth },
      { onConflict: "user_id,endpoint" },
    );
  if (error) {
    throw new Error(`Kunne ikke lagre varselabonnementet: ${error.message}`);
  }
}

export function SimulatorPushToggle({ userId }: { userId: string }) {
  const [state, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setState("unsupported");
        return;
      }
      if (!vapidPublicKey) {
        if (active) setState("setup");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("blocked");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && Notification.permission === "granted") {
          await saveSubscription(userId, subscription);
          if (active) setState("on");
        } else if (active) {
          setState("off");
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : String(error));
          setState("error");
        }
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [userId]);

  const enable = async () => {
    setMessage("");
    setState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(vapidPublicKey!),
      });
      await saveSubscription(userId, subscription);
      setState("on");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  };

  const disable = async () => {
    setMessage("");
    setState("loading");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { error } = await requireSupabase()
          .from("sim_push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint);
        if (error) throw new Error(`Kunne ikke slå av varsler: ${error.message}`);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setState("error");
    }
  };

  return (
    <section className="panel sim-push-panel" aria-label="Kjøpsvarsler">
      <div>
        <strong>Varsler om simulatorkjøp</strong>
        <p>
          {state === "on"
            ? "På — du får pushvarsel også når nettsiden er lukket."
            : state === "setup"
              ? "Pushvarsler er ikke konfigurert ennå."
              : state === "unsupported"
                ? "Denne nettleseren støtter ikke pushvarsler. Prøv Chrome på Android."
                : state === "blocked"
                  ? "Varsler er blokkert i nettleseren. Endre tillatelsen i Chrome-innstillingene."
                  : "Få et varsel på telefonen når en av papirporteføljene kjøper."}
        </p>
        {message ? <small className="tone-negative">{message}</small> : null}
      </div>
      {state === "on" ? (
        <button className="btn btn-ghost" type="button" onClick={() => void disable()}>
          Slå av varsler
        </button>
      ) : (
        <button
          className="btn btn-primary"
          type="button"
          disabled={state !== "off" && state !== "error"}
          onClick={() => void enable()}
        >
          {state === "loading"
            ? "Sjekker …"
            : state === "error"
              ? "Prøv igjen"
              : "Slå på varsler"}
        </button>
      )}
    </section>
  );
}
