const STORAGE_KEY = "subtitle-ui:admin-token";

export function getAdminToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function setAdminToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  const value = token.trim();
  try {
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export function clearAdminToken() {
  setAdminToken("");
}
