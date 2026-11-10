/* Background push handling for the generated Workbox service worker. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Simulatoren har handlet";
  const actions = [];
  if (
    typeof payload.nordnetUrl === "string" &&
    payload.nordnetUrl.startsWith("https://www.nordnet.no/aksjer/kurser/")
  ) {
    actions.push({
      action: "nordnet",
      title: `Åpne ${payload.ticker || "aksjen"} hos Nordnet`,
    });
  }
  actions.push({ action: "simulator", title: "Åpne simulator" });
  const options = {
    body: payload.body || "En ny handel er registrert i simulatoren.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: payload.tag || "simulator-trade",
    actions,
    data: {
      url: new URL("simulator/", self.registration.scope).href,
      nordnetUrl: payload.nordnetUrl,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const nordnetUrl = event.notification.data?.nordnetUrl;
  if (
    event.action === "nordnet" &&
    typeof nordnetUrl === "string" &&
    nordnetUrl.startsWith("https://www.nordnet.no/aksjer/kurser/")
  ) {
    event.waitUntil(clients.openWindow(nordnetUrl));
    return;
  }
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const windowClient of windows) {
        if ("focus" in windowClient && windowClient.url.startsWith(self.registration.scope)) {
          windowClient.navigate(target);
          return windowClient.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
