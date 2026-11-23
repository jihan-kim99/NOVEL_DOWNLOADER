import type { CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";

const VOID_TAGS = new Set(["br", "hr", "img"]);

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "ruby",
  "rb",
  "rp",
  "rt",
  "rtc",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "span",
  "sub",
  "sup",
  "a",
  "img",
  "div",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "iframe", "svg"]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt"]),
  em: new Set(["class"]),
  span: new Set(["class"]),
  p: new Set(["class", "id"]),
  div: new Set(["class"]),
};

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (cleaned || "novel").slice(0, 180);
}

function serializeNode(node: AnyNode): string {
  if (node.type === "text") {
    return escapeXml(node.data || "");
  }

  if (node.type !== "tag") {
    return "";
  }

  const el = node as Element;
  const tag = el.name.toLowerCase();

  if (SKIP_TAGS.has(tag)) {
    return "";
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap unknown tags but preserve their children
    return (el.children || []).map(serializeNode).join("");
  }

  const allowedAttrs = ALLOWED_ATTRS[tag];
  let attrStr = "";
  if (allowedAttrs && el.attribs) {
    for (const [key, value] of Object.entries(el.attribs)) {
      const lowerKey = key.toLowerCase();
      if (!allowedAttrs.has(lowerKey)) continue;
      if (lowerKey === "href" || lowerKey === "src") {
        const trimmed = (value || "").trim();
        if (!trimmed || /^javascript:/i.test(trimmed)) continue;
        // Normalize protocol-relative URLs
        const normalized = trimmed.startsWith("//")
          ? `https:${trimmed}`
          : trimmed;
        attrStr += ` ${lowerKey}="${escapeXml(normalized)}"`;
      } else if (value !== undefined) {
        attrStr += ` ${lowerKey}="${escapeXml(value)}"`;
      }
    }
  }

  if (VOID_TAGS.has(tag)) {
    return `<${tag}${attrStr} />`;
  }

  const inner = (el.children || []).map(serializeNode).join("");
  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

/**
 * Serializes a single Cheerio element into guaranteed valid XHTML.
 */
export function elementToXhtml(el: AnyNode): string {
  return serializeNode(el);
}

/**
 * Serializes the children of a Cheerio selection into guaranteed valid XHTML.
 */
export function childrenToXhtml($: CheerioAPI, nodes: AnyNode[]): string {
  return nodes.map(serializeNode).join("");
}

/**
 * Serializes paragraph elements inside a container into valid XHTML paragraphs.
 */
export function paragraphsToXhtml($: CheerioAPI, container: ReturnType<CheerioAPI>): string {
  const paragraphs = container.find("p");
  if (paragraphs.length > 0) {
    const parts: string[] = [];
    paragraphs.each((_, el) => {
      parts.push(serializeNode(el));
    });
    return parts.join("\n");
  }
  return childrenToXhtml($, container.contents().toArray());
}
