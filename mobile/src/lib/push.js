import api from "./api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

// iOS Safari only exposes PushManager once the PWA has been added to the
// home screen (iOS 16.4+) - detected separately so the UI can say "add to
// home screen first" instead of a generic "not supported here".
export function isIosNotInstalled() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return isIos && !isStandalone && !isPushSupported();
}

export async function getPushSubscriptionState() {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  return existing ? "subscribed" : "unsubscribed";
}

export async function subscribeToPush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permission not granted");

  const registration = await navigator.serviceWorker.ready;
  const { data } = await api.get("/push/vapid-public-key");
  if (!data.key) throw new Error("Push isn't configured on the server yet");

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.key),
  });

  const json = subscription.toJSON();
  await api.post("/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
  return subscription;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return;
  await api.delete("/push/subscribe", { data: { endpoint: existing.endpoint } });
  await existing.unsubscribe();
}
