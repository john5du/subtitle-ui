import { resolveApiBase } from "@/lib/api";

export function resolveMcpAbsoluteUrl(
  endpoint = "/mcp",
  options?: { apiBase?: string; origin?: string }
): string {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const configured = (options?.apiBase ?? resolveApiBase()).replace(/\/+$/, "");
  if (configured) {
    return `${configured}${path}`;
  }
  const origin = (
    options?.origin ?? (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/+$/, "");
  if (origin) {
    return `${origin}${path}`;
  }
  return path;
}

export function buildMcpClientConfigJson(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "subtitle-ui": {
          url,
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      }
    },
    null,
    2
  );
}
