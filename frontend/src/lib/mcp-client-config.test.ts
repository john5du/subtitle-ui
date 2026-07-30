import { describe, expect, test } from "bun:test";

import { buildMcpClientConfigJson, resolveMcpAbsoluteUrl } from "./mcp-client-config";

describe("resolveMcpAbsoluteUrl", () => {
  test("uses apiBase when provided", () => {
    expect(resolveMcpAbsoluteUrl("/mcp", { apiBase: "http://localhost:9307" })).toBe(
      "http://localhost:9307/mcp"
    );
  });

  test("strips trailing slash on apiBase", () => {
    expect(resolveMcpAbsoluteUrl("/mcp", { apiBase: "http://localhost:9307/" })).toBe(
      "http://localhost:9307/mcp"
    );
  });

  test("falls back to origin when apiBase empty", () => {
    expect(resolveMcpAbsoluteUrl("/mcp", { apiBase: "", origin: "https://sub.example.com" })).toBe(
      "https://sub.example.com/mcp"
    );
  });

  test("returns path when no base or origin", () => {
    expect(resolveMcpAbsoluteUrl("/mcp", { apiBase: "", origin: "" })).toBe("/mcp");
  });

  test("normalizes endpoint without leading slash", () => {
    expect(resolveMcpAbsoluteUrl("mcp", { apiBase: "http://h" })).toBe("http://h/mcp");
  });
});

describe("buildMcpClientConfigJson", () => {
  test("builds Cursor-style remote MCP config", () => {
    const json = buildMcpClientConfigJson("http://127.0.0.1:9307/mcp", "secret-token");
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        "subtitle-ui": {
          url: "http://127.0.0.1:9307/mcp",
          headers: {
            Authorization: "Bearer secret-token"
          }
        }
      }
    });
  });
});
