const TOKEN_KEY = "ledgerly_pulse_token";
const USER_KEY = "ledgerly_pulse_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function updateStoredUser(patch) {
  const updated = { ...getUser(), ...patch };
  localStorage.setItem(USER_KEY, JSON.stringify(updated));
  return updated;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated() {
  return Boolean(getToken());
}
