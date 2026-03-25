"use client";

import { buildApiURL } from "@/lib/api";

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

export async function requestPayload<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(buildApiURL(path), options);
  const payload = await readPayload(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `request failed: ${response.status}`));
  }

  return payload as T;
}

export async function requestBinary(path: string, options: RequestInit = {}) {
  const response = await fetch(buildApiURL(path), options);
  if (!response.ok) {
    const payload = await readPayload(response);
    throw new Error(extractErrorMessage(payload, `request failed: ${response.status}`));
  }

  return response.arrayBuffer();
}
