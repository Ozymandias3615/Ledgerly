const THEME_KEY = "ledgerly_mobile_theme";

// "system" (default) follows the device's prefers-color-scheme; "light"/"dark"
// are explicit user overrides applied via a [data-theme] attribute that beats
// the prefers-color-scheme media query in index.css.
export function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "system";
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function setTheme(theme) {
  if (theme === "system") {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, theme);
  }
  applyTheme(theme);
}

export function nextTheme(current) {
  return { system: "light", light: "dark", dark: "system" }[current];
}
