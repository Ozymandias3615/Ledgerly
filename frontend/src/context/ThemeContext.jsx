import React, { createContext, useContext, useEffect, useState } from "react";
import { loadPersisted, savePersisted } from "@/lib/utils_app";

const ThemeContext = createContext(null);

export const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "ocean", label: "Ocean" },
  { value: "grey", label: "Grey" },
  { value: "sage", label: "Sage" },
  { value: "amber", label: "Amber" },
  { value: "violet", label: "Violet" },
  { value: "indigo", label: "Indigo" },
  { value: "rose", label: "Rose" },
  { value: "custom", label: "Custom" },
];

const THEME_CLASSES = {
  dark: "dark",
  ocean: "theme-ocean",
  grey: "theme-grey",
  sage: "theme-sage",
  amber: "theme-amber",
  violet: "theme-violet",
  indigo: "theme-indigo",
  rose: "theme-rose",
};

export const DEFAULT_CUSTOM_COLORS = { background: "#f5f6fa", primary: "#3457d5" };

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function hexToHsl(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.substring(0, 2), 16) / 255;
  const g = parseInt(full.substring(2, 4), 16) / 255;
  const b = parseInt(full.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const hsl = (h, s, l) => `${h} ${s}% ${l}%`;

// Only --background and --primary are user-picked; every other token is
// derived from them so the result reads as a coherent theme (correct text
// contrast, subtle borders/secondary surfaces) instead of two colors dropped
// onto an unrelated palette. Falls back to the same neutral-scale inversion
// :root.dark uses when the picked background is dark, so slate-* utility
// classes elsewhere in the app still read correctly.
export function deriveCustomVars(backgroundHex, primaryHex) {
  const [bh, bs, bl] = hexToHsl(backgroundHex);
  const [ph, ps, pl] = hexToHsl(primaryHex);
  const isDarkBg = bl < 50;

  const foreground = isDarkBg ? "210 40% 98%" : "222 47% 11%";
  const card = isDarkBg ? hsl(bh, clamp(bs + 5, 0, 100), clamp(bl + 6, 0, 100)) : "0 0% 100%";
  const secondary = hsl(bh, bs, isDarkBg ? clamp(bl + 10, 0, 100) : clamp(bl - 6, 0, 100));

  const vars = {
    "--background": hsl(bh, bs, bl),
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": foreground,
    "--popover": card,
    "--popover-foreground": foreground,
    "--primary": hsl(ph, ps, pl),
    "--primary-hover": hsl(ph, ps, isDarkBg ? clamp(pl + 8, 0, 100) : clamp(pl - 8, 0, 100)),
    "--primary-foreground": pl >= 55 ? "222 47% 11%" : "0 0% 98%",
    "--secondary": secondary,
    "--secondary-foreground": foreground,
    "--muted": secondary,
    "--muted-foreground": isDarkBg ? "215 16% 68%" : "215 16% 47%",
    "--accent": hsl(ph, clamp(ps - 10, 0, 100), isDarkBg ? clamp(pl - 25, 10, 100) : clamp(pl + 40, 0, 95)),
    "--accent-foreground": hsl(ph, ps, isDarkBg ? clamp(pl + 30, 0, 90) : clamp(pl - 15, 10, 100)),
    "--border": hsl(bh, clamp(bs - 10, 0, 100), isDarkBg ? clamp(bl + 14, 0, 100) : clamp(bl - 12, 0, 100)),
    "--ring": hsl(ph, ps, pl),
  };
  vars["--input"] = vars["--border"];

  if (isDarkBg) {
    Object.assign(vars, {
      "--slate-50": "222 47% 11%",
      "--slate-100": "217 33% 17%",
      "--slate-200": "215 25% 24%",
      "--slate-300": "215 19% 32%",
      "--slate-400": "215 16% 46%",
      "--slate-500": "215 16% 58%",
      "--slate-600": "215 20% 70%",
      "--slate-700": "213 27% 80%",
      "--slate-800": "214 32% 90%",
      "--slate-900": "210 40% 98%",
    });
  }
  return vars;
}

const CUSTOM_VAR_NAMES = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-hover", "--primary-foreground", "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground", "--accent", "--accent-foreground", "--border", "--input", "--ring",
  "--slate-50", "--slate-100", "--slate-200", "--slate-300", "--slate-400", "--slate-500", "--slate-600", "--slate-700", "--slate-800", "--slate-900",
];

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => loadPersisted("ledgerly_theme", "light"));
  const [customColors, setCustomColorsState] = useState(() => loadPersisted("ledgerly_custom_colors", DEFAULT_CUSTOM_COLORS));

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...Object.values(THEME_CLASSES));
    CUSTOM_VAR_NAMES.forEach((name) => root.style.removeProperty(name));
    if (theme === "custom") {
      const vars = deriveCustomVars(customColors.background, customColors.primary);
      Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
    } else if (THEME_CLASSES[theme]) {
      root.classList.add(THEME_CLASSES[theme]);
    }
  }, [theme, customColors]);

  const setTheme = (next) => {
    setThemeState(next);
    savePersisted("ledgerly_theme", next);
  };

  const setCustomColors = (next) => {
    setCustomColorsState(next);
    savePersisted("ledgerly_custom_colors", next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, customColors, setCustomColors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
