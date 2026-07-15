import { describe, expect, test } from "bun:test";

import { ApiRequestError, extractErrorMessage, isRecord } from "./api-client";

describe("isRecord", () => {
  test("accepts plain objects only", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ error: "x" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord([])).toBe(true);
  });
});

describe("extractErrorMessage", () => {
  test("prefers payload.error", () => {
    expect(extractErrorMessage({ error: "bad request" }, "fallback")).toBe("bad request");
  });

  test("uses string payload", () => {
    expect(extractErrorMessage("plain error", "fallback")).toBe("plain error");
  });

  test("falls back when empty", () => {
    expect(extractErrorMessage(null, "fallback")).toBe("fallback");
    expect(extractErrorMessage({ error: "  " }, "fallback")).toBe("fallback");
  });
});

describe("ApiRequestError", () => {
  test("extracts code and entries from payload", () => {
    const entries = [{ path: "a.ass", fileName: "a.ass", size: 1 }];
    const err = new ApiRequestError("failed", 409, {
      error: "conflict",
      code: "archive_choice_required",
      entries
    });
    expect(err.status).toBe(409);
    expect(err.code).toBe("archive_choice_required");
    expect(err.entries).toEqual(entries);
    expect(err.message).toBe("failed");
  });
});
