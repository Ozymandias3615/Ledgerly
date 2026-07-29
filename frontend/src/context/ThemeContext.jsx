import React, { createContext, useContext, useEffect, useState } from "react";
import { loadPersisted, savePersisted } from "@/lib/utils_app";

const ThemeContext = createContext(null);

export const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "ocean", label: "Ocean" },
  { value: "grey", label: "Grey" },
];

const THEME_CLASSES = { dark: "dark", ocean: "theme-ocean", grey: "theme-grey" };

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => loadPersisted("ledgerly_theme", "light"));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...Object.values(THEME_CLASSES));
    if (THEME_CLASSES[theme]) root.classList.add(THEME_CLASSES[theme]);
  }, [theme]);

  const setTheme = (next) => {
    setThemeState(next);
    savePersisted("ledgerly_theme", next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
