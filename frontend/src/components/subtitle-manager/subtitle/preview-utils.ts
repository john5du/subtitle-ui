const SUBTITLE_PREVIEW_CHAR_LIMIT = 100000;
const SUBTITLE_PREVIEW_ENCODINGS = ["utf-8", "utf-16le", "utf-16be", "gb18030", "big5"] as const;

function orderedSubtitlePreviewEncodings(bytes: Uint8Array) {
  const out: string[] = [];
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      out.push("utf-16le");
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      out.push("utf-16be");
    }
  }
  for (const encoding of SUBTITLE_PREVIEW_ENCODINGS) {
    if (!out.includes(encoding)) {
      out.push(encoding);
    }
  }
  return out;
}

function decodeSubtitleBytes(bytes: Uint8Array, encoding: string, fatal: boolean) {
  try {
    const decoder = new TextDecoder(encoding, { fatal });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function decodeSubtitleBuffer(buffer: ArrayBuffer, maxChars: number | null) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return { text: "", encoding: "utf-8", truncated: false };
  }

  for (const encoding of orderedSubtitlePreviewEncodings(bytes)) {
    const decoded = decodeSubtitleBytes(bytes, encoding, true);
    if (decoded === null) {
      continue;
    }
    if (maxChars == null || decoded.length <= maxChars) {
      return { text: decoded, encoding, truncated: false };
    }
    return {
      text: decoded.slice(0, maxChars),
      encoding,
      truncated: true
    };
  }

  const fallback = decodeSubtitleBytes(bytes, "utf-8", false);
  if (fallback !== null) {
    if (maxChars == null || fallback.length <= maxChars) {
      return { text: fallback, encoding: "utf-8", truncated: false };
    }
    return {
      text: fallback.slice(0, maxChars),
      encoding: "utf-8",
      truncated: true
    };
  }

  throw new Error("unable to decode subtitle content");
}

export function decodeSubtitlePreviewContent(buffer: ArrayBuffer) {
  return decodeSubtitleBuffer(buffer, SUBTITLE_PREVIEW_CHAR_LIMIT);
}

/** Full decode for playback cue conversion (no char cap). */
export function decodeSubtitleFullContent(buffer: ArrayBuffer) {
  return decodeSubtitleBuffer(buffer, null);
}

export { SUBTITLE_PREVIEW_CHAR_LIMIT };
