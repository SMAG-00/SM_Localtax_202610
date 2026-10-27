// .docx 생성기 (W13-b b6, PRD-05 WS-05) - 새 의존 0. 압축 없이 저장만 하는 zip + 최소 WordprocessingML.
// 서버 전용 모듈(브라우저 번들에 넣지 않는다 - 페이지에서 import 금지). 시계는 인자로만 받는다.
import { crc32 } from "node:zlib";
import { AI_DRAFT_LABEL, citationLine, hasCitation, type ExportItem } from "./logic";

// XML 1.0에서 허용되지 않는 제어 문자는 지운다
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string): string => s.replace(INVALID_XML, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const run = (text: string, o: { bold?: boolean; size?: number } = {}): string =>
  `<w:r><w:rPr>${o.bold ? "<w:b/>" : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/** 줄바꿈은 같은 문단 안의 w:br로 */
const para = (text: string, o: { bold?: boolean; size?: number; citation?: boolean } = {}): string => {
  const lines = text.split(/\r\n|\r|\n/);
  const runs = lines.map((l, i) => (i === 0 ? "" : "<w:r><w:br/></w:r>") + run(l, o)).join("");
  // 인용 문단은 w:pStyle로 표지를 달아 개수를 셀 수 있게 한다
  return `<w:p>${o.citation ? '<w:pPr><w:pStyle w:val="Citation"/></w:pPr>' : ""}${runs}</w:p>`;
};

export interface DocxInput {
  title: string;
  exportedOn: string;
  items: readonly ExportItem[];
}

export function documentXml(input: DocxInput): string {
  const body: string[] = [para(input.title, { bold: true, size: 36 }), para(`내보낸 날짜: ${input.exportedOn}`), para(`항목 ${input.items.length}건 · 인용 ${input.items.filter(hasCitation).length}건`)];
  input.items.forEach((item, idx) => {
    body.push(para(`${idx + 1}. ${item.title}`, { bold: true, size: 26 }));
    if (item.aiDraft) body.push(para(`[${AI_DRAFT_LABEL}]`, { bold: true }));
    if (hasCitation(item)) body.push(para(`인용: ${citationLine(item)}`, { citation: true }));
    if (item.memo) body.push(para(item.memo));
    if (item.excerpt) body.push(para(`발췌: ${item.excerpt}`));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Citation"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>`;

interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(now: Date): { time: number; date: number } {
  const y = Math.max(1980, now.getUTCFullYear());
  return {
    time: (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((now.getUTCMonth() + 1) << 5) | now.getUTCDate(),
  };
}

/** 압축 없이 저장만 하는 zip (method 0). 이름은 UTF-8 */
export function zipStore(entries: readonly ZipEntry[], now: Date): Buffer {
  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.data);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function buildDocx(input: DocxInput, now: Date): Buffer {
  return zipStore(
    [
      { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
      { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
      { name: "word/document.xml", data: Buffer.from(documentXml(input), "utf8") },
      { name: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS, "utf8") },
      { name: "word/styles.xml", data: Buffer.from(STYLES, "utf8") },
    ],
    now,
  );
}
