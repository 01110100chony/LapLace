export const themes = ["Noir", "Astra", "Quartz"] as const;
export type Theme = (typeof themes)[number];

const themeKey = "laplace.theme";
const pauseKey = "laplace.spectral-paused";

function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The active window can still use its in-memory preference.
  }
}

export function initialTheme() {
  const saved = readPreference(themeKey);
  return themes.find((theme) => theme === saved) ?? "Noir";
}

export function saveTheme(theme: Theme) {
  savePreference(themeKey, theme);
}

export function initialPause() {
  return readPreference(pauseKey) === "true";
}

export function savePause(paused: boolean) {
  savePreference(pauseKey, String(paused));
}
