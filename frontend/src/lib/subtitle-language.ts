/** Shared subtitle language label helpers for display + upload defaults. */

const BILINGUAL_NAME_RE =
  /双语|bilingual|中英|简英|繁英|(?:chs|cht|zh)[._\-\s&+]*(?:en|eng)|(?:en|eng)[._\-\s&+]*(?:chs|cht|zh)/i;
const TRADITIONAL_NAME_RE = /繁体|繁中|cht|big5|zh[-_.\s]?hant|\btc\b/i;
const SIMPLIFIED_NAME_RE = /简体|简中|chs|gb|zh[-_.\s]?hans|\bsc\b/i;
const ENGLISH_NAME_RE = /英语|english|\beng\b|\ben\b/i;
const CHINESE_NAME_RE = /中文|国语|粤语|chinese|\bchi\b|\bzh\b/i;

export function isBilingualLanguage(language: string | undefined | null): boolean {
  const raw = String(language || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "und") {
    return false;
  }
  if (raw.includes("&") || raw.includes("+") || raw.includes(",")) {
    return true;
  }
  // Legacy on-disk sanitize form: zh-en / en-zh
  const dashParts = raw.split("-").filter(Boolean);
  if (dashParts.length >= 2) {
    const known = new Set(["zh", "en", "chs", "cht", "chi", "eng", "ja", "ko", "jp", "kr", "zh-hant", "zh-hans"]);
    const mapped = dashParts.map((p) => {
      if (p === "chs" || p === "chi" || p === "zh" || p === "sc") return "zh";
      if (p === "cht" || p === "tc") return "zh-hant";
      if (p === "eng") return "en";
      return p;
    });
    const distinct = new Set(mapped.filter((p) => known.has(p) || p === "zh" || p === "en" || p === "zh-hant"));
    // zh-en style (two language primaries), not zh-hant / zh-hans / zh-cn
    if (distinct.size >= 2 && !["hans", "hant", "cn", "tw", "hk", "us", "gb"].includes(dashParts[1] || "")) {
      const second = dashParts[1];
      if (["en", "eng", "zh", "chs", "cht", "chi"].includes(second)) {
        return true;
      }
    }
  }
  return false;
}

export function formatSubtitleLanguageLabel(language: string | undefined | null): string {
  const raw = String(language || "").trim();
  if (!raw || raw.toLowerCase() === "und") {
    return raw || "und";
  }
  const lower = raw.toLowerCase();
  if (isBilingualLanguage(lower)) {
    return lower;
  }
  switch (lower) {
    case "zh":
    case "chs":
    case "chi":
    case "zh-cn":
    case "zh-hans":
      return "zh";
    case "zh-hant":
    case "cht":
    case "zh-tw":
    case "zh-hk":
      return "zh-hant";
    case "eng":
      return "en";
    default:
      return lower;
  }
}

/** Human-readable language for UI (uses i18n keys via caller). */
export type SubtitleLanguageDisplay = {
  code: string;
  bilingual: boolean;
  /** i18n key for primary badge text when available */
  labelKey?:
    | "language.bilingual"
    | "language.simplified"
    | "language.traditional"
    | "language.english"
    | "language.japanese"
    | "language.korean"
    | "language.unknown";
};

export function describeSubtitleLanguage(language: string | undefined | null): SubtitleLanguageDisplay {
  const code = formatSubtitleLanguageLabel(language);
  if (!code || code === "und") {
    return { code: code || "und", bilingual: false, labelKey: "language.unknown" };
  }
  if (isBilingualLanguage(code)) {
    return { code, bilingual: true, labelKey: "language.bilingual" };
  }
  switch (code) {
    case "zh":
      return { code, bilingual: false, labelKey: "language.simplified" };
    case "zh-hant":
      return { code, bilingual: false, labelKey: "language.traditional" };
    case "en":
      return { code, bilingual: false, labelKey: "language.english" };
    case "ja":
    case "jpn":
    case "jp":
      return { code: "ja", bilingual: false, labelKey: "language.japanese" };
    case "ko":
    case "kor":
    case "kr":
      return { code: "ko", bilingual: false, labelKey: "language.korean" };
    default:
      return { code, bilingual: false };
  }
}

/** Single short label for list UI (e.g. 双语 / 简中 / en). Raw code kept as title elsewhere. */
export function subtitleLanguageDisplayText(
  language: string | undefined | null,
  t: (key: NonNullable<SubtitleLanguageDisplay["labelKey"]>) => string
): string {
  const lang = describeSubtitleLanguage(language);
  if (lang.labelKey) {
    return t(lang.labelKey);
  }
  return lang.code || "-";
}

/** Infer filename language label for upload defaults (backend still re-checks content). */
export function inferUploadLanguageLabel(fileNameOrPath: string): string {
  const text = String(fileNameOrPath || "");
  const lower = text.toLowerCase();
  const bilingual = BILINGUAL_NAME_RE.test(text) || BILINGUAL_NAME_RE.test(lower);
  const traditional = TRADITIONAL_NAME_RE.test(text) || TRADITIONAL_NAME_RE.test(lower);
  const simplified = SIMPLIFIED_NAME_RE.test(text) || SIMPLIFIED_NAME_RE.test(lower);
  const hasZh =
    simplified ||
    traditional ||
    CHINESE_NAME_RE.test(text) ||
    CHINESE_NAME_RE.test(lower) ||
    /中文|国语|粤语|简|繁/.test(text);
  const hasEn = ENGLISH_NAME_RE.test(text) || ENGLISH_NAME_RE.test(lower) || /英/.test(text);

  if (bilingual || (hasZh && hasEn)) {
    if (traditional && !simplified) {
      return "zh-hant&en";
    }
    return "zh&en";
  }
  if (hasZh) {
    if (traditional && !simplified) {
      return "zh-hant";
    }
    return "zh";
  }
  if (hasEn) {
    return "en";
  }
  if (/日语|日文|japanese|\bjpn\b|\bjp\b/i.test(text)) {
    return "ja";
  }
  if (/韩语|韩文|korean|\bkor\b|\bkr\b/i.test(text)) {
    return "ko";
  }
  return "zh";
}

export const UPLOAD_LANGUAGE_PRESETS = [
  { value: "zh&en", labelKey: "language.bilingual" as const },
  { value: "zh", labelKey: "language.simplified" as const },
  { value: "zh-hant", labelKey: "language.traditional" as const },
  { value: "en", labelKey: "language.english" as const }
];
