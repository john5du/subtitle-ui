"use client";

import { getAdminToken } from "@/lib/admin-token";
import { buildApiURL } from "@/lib/api";
import type { ArchiveEntryMeta } from "@/lib/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  return fallback;
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  entries?: ArchiveEntryMeta[];
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
    if (isRecord(payload)) {
      if (typeof payload.code === "string") {
        this.code = payload.code;
      }
      if (Array.isArray(payload.entries)) {
        this.entries = payload.entries as ArchiveEntryMeta[];
      }
    }
  }
}

async function readPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
}

function withAuthHeaders(options: RequestInit = {}): RequestInit {
  const headers = new Headers(options.headers);
  const token = getAdminToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...options, headers };
}

export async function requestPayload<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(buildApiURL(path), withAuthHeaders(options));
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new ApiRequestError(extractErrorMessage(payload, `request failed: ${response.status}`), response.status, payload);
  }

  return payload as T;
}

export async function requestBinary(path: string, options: RequestInit = {}) {
  const response = await fetch(buildApiURL(path), withAuthHeaders(options));
  if (!response.ok) {
    const payload = await readPayload(response);
    throw new ApiRequestError(extractErrorMessage(payload, `request failed: ${response.status}`), response.status, payload);
  }

  return response.arrayBuffer();
}

/** Probe API auth without using the stored token. */
export async function probeAPIAuth(): Promise<"open" | "required" | "error"> {
  try {
    const response = await fetch(buildApiURL("/api/version"), { method: "GET", cache: "no-store" });
    if (response.status === 401) {
      return "required";
    }
    if (response.ok) {
      return "open";
    }
    return "error";
  } catch {
    return "error";
  }
}

/** Validate a candidate token (or the stored one) against a protected endpoint. */
export async function validateAdminToken(token?: string): Promise<boolean> {
  const candidate = (token ?? getAdminToken()).trim();
  if (!candidate) {
    return false;
  }
  try {
    const response = await fetch(buildApiURL("/api/version"), {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${candidate}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}
