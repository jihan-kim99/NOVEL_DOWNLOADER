import JSZip from "jszip";
import { saveAs } from "file-saver";
import { escapeXml, sanitizeFilename } from "./xhtml";

export interface Chapter {
  title: string;
  fileName: string;
}

const EPUB_CSS = `body {
  font-family: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif;
  line-height: 1.8;
  margin: 1.2em;
}
h1, h2, h3 {
  line-height: 1.4;
  margin-bottom: 1em;
}
p {
  margin: 0.4em 0;
}
hr.section-break {
  border: none;
  border-top: 1px solid #bbb;
  margin: 1.5em 2em;
}
em.emphasisDots {
  font-style: normal;
  -webkit-text-emphasis: filled sesame;
  text-emphasis: filled sesame;
}
`;

export function buildChapterXhtml(epTitle: string, content: string): string {
  const safeTitle = escapeXml(epTitle || "Episode");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
  <h3>${safeTitle}</h3>
  ${content}
</body>
</html>`;
}

export interface GeneratedEpub {
  blob: Blob;
  fileName: string;
}

export async function generateEpub(
  title: string,
  bookId: string,
  chapters: Chapter[],
  zip: JSZip,
  author?: string
): Promise<GeneratedEpub> {
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder");

  const safeTitle = escapeXml(title || "Unknown Title");
  const safeBookId = escapeXml(bookId || "unknown");
  const creatorXml = author
    ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>`
    : "";

  oebps.file("styles.css", EPUB_CSS);

  const manifestItems = chapters
    .map(
      (ch, i) =>
        `    <item id="chapter_${i + 1}" href="${escapeXml(
          ch.fileName
        )}" media-type="application/xhtml+xml"/>`
    )
    .join("\n");

  const spineItems = chapters
    .map((_, i) => `    <itemref idref="chapter_${i + 1}"/>`)
    .join("\n");

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${safeTitle}</dc:title>${creatorXml}
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:${safeBookId}</dc:identifier>
    <meta property="dcterms:modified">${
      new Date().toISOString().split(".")[0]
    }Z</meta>
  </metadata>
  <manifest>
    <item id="styles" href="styles.css" media-type="text/css"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
${spineItems}
  </spine>
</package>`;

  oebps.file("content.opf", contentOpf);

  const navLinks = chapters
    .map(
      (ch) =>
        `    <li><a href="${escapeXml(ch.fileName)}">${escapeXml(
          ch.title
        )}</a></li>`
    )
    .join("\n");

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head>
  <meta charset="utf-8" />
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css" />
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>${safeTitle}</h1>
  <ol>
${navLinks}
  </ol>
</nav>
</body>
</html>`;
  oebps.file("nav.xhtml", navXhtml);

  const ncxPoints = chapters
    .map(
      (ch, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="${escapeXml(ch.fileName)}"/>
    </navPoint>`
    )
    .join("\n");

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${safeBookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
${ncxPoints}
  </navMap>
</ncx>`;
  oebps.file("toc.ncx", tocNcx);

  const content = await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  });
  const fileName = `${sanitizeFilename(title)}.epub`;
  saveAs(content, fileName);
  return { blob: content, fileName };
}

export function initializeEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")?.file(
    "container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder");
  return { zip, oebps };
}
