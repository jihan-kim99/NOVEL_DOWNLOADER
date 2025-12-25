import JSZip from "jszip";
import { saveAs } from "file-saver";

export interface Chapter {
  title: string;
  fileName: string;
}

export async function generateEpub(
  title: string,
  bookId: string,
  chapters: Chapter[],
  zip: JSZip
) {
  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder");

  // Generate content.opf
  const manifestItems = chapters
    .map(
      (ch, i) =>
        `<item id="chapter_${i + 1}" href="${
          ch.fileName
        }" media-type="application/xhtml+xml"/>`
    )
    .join("\n");
  const spineItems = chapters
    .map((ch, i) => `<itemref idref="chapter_${i + 1}"/>`)
    .join("\n");

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:language>ja</dc:language>
    <dc:identifier id="BookId">urn:uuid:${bookId}</dc:identifier>
    <meta property="dcterms:modified">${
      new Date().toISOString().split(".")[0]
    }Z</meta>
  </metadata>
  <manifest>
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

  // Generate nav.xhtml
  const navLinks = chapters
    .map((ch) => `<li><a href="${ch.fileName}">${ch.title}</a></li>`)
    .join("\n");
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ja">
<head><title>Table of Contents</title></head>
<body>
<nav epub:type="toc" id="toc">
  <h1>Table of Contents</h1>
  <ol>
    ${navLinks}
  </ol>
</nav>
</body>
</html>`;
  oebps.file("nav.xhtml", navXhtml);

  // Generate toc.ncx
  const ncxPoints = chapters
    .map(
      (ch, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${ch.title}</text></navLabel>
      <content src="${ch.fileName}"/>
    </navPoint>`
    )
    .join("");

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookId}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${ncxPoints}
  </navMap>
</ncx>`;
  oebps.file("toc.ncx", tocNcx);

  // Generate and save file
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `${title}.epub`);
}

export function initializeEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")?.file(
    "container.xml",
    `<?xml version="1.0"?>
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
