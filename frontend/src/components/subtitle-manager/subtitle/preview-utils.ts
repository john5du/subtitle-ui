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

function trimSubtitlePreviewText(text: string) {
  if (text.length <= SUBTITLE_PREVIEW_CHAR_LIMIT) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, SUBTITLE_PREVIEW_CHAR_LIMIT),
    truncated: true
  };
}

export function decodeSubtitlePreviewContent(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return { text: "", encoding: "utf-8", truncated: false };
  }

  for (const encoding of orderedSubtitlePreviewEncodings(bytes)) {
    const decoded = decodeSubtitleBytes(bytes, encoding, true);
    if (decoded === null) {
      continue;
    }
    const normalized = trimSubtitlePreviewText(decoded);
    return {
      text: normalized.text,
      encoding,
      truncated: normalized.truncated
    };
  }

  const fallback = decodeSubtitleBytes(bytes, "utf-8", false);
  if (fallback !== null) {
    const normalized = trimSubtitlePreviewText(fallback);
    return {
      text: normalized.text,
      encoding: "utf-8",
      truncated: normalized.truncated
    };
  }

  throw new Error("unable to decode subtitle content");
}

export { SUBTITLE_PREVIEW_CHAR_LIMIT };
