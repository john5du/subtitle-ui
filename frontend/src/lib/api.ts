export function resolveApiBase() {
  const configured = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location.port === "3300") {
    return "http://localhost:9307";
  }

  return "";
}

export function buildApiURL(path: string) {
  const base = resolveApiBase();
  if (!base) return path;
  return `${base}${path}`;
}
