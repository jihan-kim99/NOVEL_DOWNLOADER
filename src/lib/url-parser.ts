export type Platform = "narou" | "kakuyomu";

export interface ParsedNovelInput {
  platform: Platform;
  bookId: string;
  /** Canonical content host, e.g. ncode.syosetu.com, novel18.syosetu.com, or kakuyomu.jp */
  domain: string;
  /** True when the user explicitly provided a host (so we know whether to auto-probe R18) */
  explicitDomain: boolean;
  /** Human-readable label for status display */
  siteLabel: string;
}

const R18_SYOSETU_HOSTS = new Set([
  "novel18.syosetu.com",
  "noc.syosetu.com",
  "mnlt.syosetu.com",
  "mid.syosetu.com",
]);

const NCODE_REGEX = /\b(n\d{4}[a-z]{1,2})\b/i;

/**
 * Normalizes and parses user input (URL or ID) for:
 * - Kakuyomu (kakuyomu.jp/works/<id>)
 * - Shosetsuka ni Narou (ncode.syosetu.com/<ncode>/)
 * - Narou R18: Nocturne / Moonlight / Midnight
 *   (novel18.syosetu.com, noc.syosetu.com, mnlt.syosetu.com, mid.syosetu.com,
 *    plus nl.syosetu.com/redirect/ageauth/?url=...)
 */
export function parseNovelInput(rawInput: string): ParsedNovelInput {
  let trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Please enter a novel URL or ID.");
  }

  // Handle Syosetu age-check redirect URLs:
  // https://nl.syosetu.com/redirect/ageauth/?url=https%3A%2F%2Fnovel18.syosetu.com%2Fn1234ab%2F
  if (trimmed.includes("nl.syosetu.com/redirect/ageauth")) {
    try {
      const parsed = new URL(
        /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      );
      const inner = parsed.searchParams.get("url");
      if (inner) {
        trimmed = inner.trim();
      }
    } catch {
      // Continue with fallback parsing
    }
  }

  // Try full URL parsing if it looks like a URL or domain
  const looksLikeUrl =
    /^https?:\/\//i.test(trimmed) ||
    /^(?:[a-z0-9-]+\.)?(?:syosetu\.com|kakuyomu\.jp)\//i.test(trimmed);

  if (looksLikeUrl) {
    let urlObj: URL;
    try {
      urlObj = new URL(
        /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      );
    } catch {
      throw new Error("Invalid URL format.");
    }

    const host = urlObj.hostname.toLowerCase();

    // 1. Kakuyomu
    if (host === "kakuyomu.jp" || host.endsWith(".kakuyomu.jp")) {
      const match = urlObj.pathname.match(/\/works\/(\d+)/);
      if (!match) {
        throw new Error(
          "Could not find a Kakuyomu work ID in that URL (expected /works/<id>)."
        );
      }
      return {
        platform: "kakuyomu",
        bookId: match[1],
        domain: "kakuyomu.jp",
        explicitDomain: true,
        siteLabel: "Kakuyomu",
      };
    }

    // 2. Narou & Narou R18 (ncode / novel18 / noc / mnlt / mid)
    if (host === "syosetu.com" || host.endsWith(".syosetu.com")) {
      const ncodeMatch = urlObj.pathname.match(NCODE_REGEX);
      if (!ncodeMatch) {
        throw new Error(
          "Could not find a Narou novel ID (ncode like n1234ab) in that URL."
        );
      }

      const bookId = ncodeMatch[1].toLowerCase();
      if (R18_SYOSETU_HOSTS.has(host)) {
        const siteLabel =
          host === "noc.syosetu.com"
            ? "Nocturne Novels (R18)"
            : host === "mnlt.syosetu.com"
            ? "Moonlight Novels (R18)"
            : host === "mid.syosetu.com"
            ? "Midnight Novels (R18)"
            : "Syosetu R18 (Nocturne / Moonlight / Midnight)";

        // All Nocturne, Moonlight, and Midnight novel pages are served on novel18.syosetu.com
        return {
          platform: "narou",
          bookId,
          domain: "novel18.syosetu.com",
          explicitDomain: true,
          siteLabel,
        };
      }

      return {
        platform: "narou",
        bookId,
        domain: "ncode.syosetu.com",
        explicitDomain: host === "ncode.syosetu.com",
        siteLabel: "Shosetsuka ni Narou",
      };
    }

    throw new Error(
      "Unsupported website. Supported sites: Kakuyomu, Shosetsuka ni Narou (ncode), and Narou R18 (novel18 / Nocturne / Moonlight / Midnight)."
    );
  }

  // Bare ID handling
  if (/^n\d{4}[a-z]{1,2}$/i.test(trimmed)) {
    return {
      platform: "narou",
      bookId: trimmed.toLowerCase(),
      domain: "ncode.syosetu.com",
      explicitDomain: false,
      siteLabel: "Narou / R18 (auto-detect)",
    };
  }

  if (/^\d{10,}$/.test(trimmed)) {
    return {
      platform: "kakuyomu",
      bookId: trimmed,
      domain: "kakuyomu.jp",
      explicitDomain: true,
      siteLabel: "Kakuyomu",
    };
  }

  throw new Error(
    "Invalid novel URL or ID. Enter a Kakuyomu URL/ID or a Narou / R18 (novel18) URL or ncode."
  );
}
