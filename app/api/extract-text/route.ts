import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';
import {
  OCR_UNSUPPORTED_MESSAGE,
  assessExtractedTextQuality,
  PDF_TEXT_EXTRACTION_PARTIAL_SUCCESS_MESSAGE,
  PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE,
  TEXT_EXTRACTION_FAILED_MESSAGE,
  validateExtractedText,
} from '@/lib/extractedTextValidation';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const supportedExtensions = ['pdf', 'docx'] as const;

type SupportedExtension = (typeof supportedExtensions)[number];

type PdfObject = {
  id: number;
  generation: number;
  body: string;
  start: number;
  bodyStart: number;
  end: number;
};

type PdfCMap = {
  mappings: Map<string, string>;
  codeLengths: number[];
};

type PdfPageExtraction = {
  pageNumber: number;
  text: string;
};

type PdfExtractionResult = {
  text: string;
  pageCount: number;
  extractedPageCount: number;
  emptyPageCount: number;
};

function decodeUtf16Be(bytes: Buffer): string {
  const codePoints: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    codePoints.push(bytes[index] * 256 + bytes[index + 1]);
  }
  return String.fromCharCode(...codePoints);
}

function getReadableCharacterCount(value: string): number {
  return Array.from(value).filter((character) =>
    /[\p{Script=Hangul}\p{Script=Latin}\p{Number}]/u.test(character),
  ).length;
}

function chooseReadableDecode(candidates: string[]): string {
  return candidates
    .map((text) => ({ text, score: getReadableCharacterCount(text) - (text.match(/\ufffd/g)?.length ?? 0) * 4 }))
    .sort((left, right) => right.score - left.score)[0]?.text ?? '';
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');

  if (!documentXml) {
    throw new Error('DOCX 본문을 찾을 수 없습니다.');
  }

  const textTokens = Array.from(
    documentXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:p>/g),
  );
  const text = textTokens
    .map((match) => {
      if (match[1] !== undefined) return decodeXmlEntities(match[1]);
      if (match[0].startsWith('<w:tab')) return '\t';
      return '\n';
    })
    .join('');

  return text.trim();
}

function decodePdfLiteralString(value: string): string {
  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      output += character;
      continue;
    }

    const next = value[index + 1];
    if (!next) continue;

    if (next === 'n') output += '\n';
    else if (next === 'r') output += '\r';
    else if (next === 't') output += '\t';
    else if (next === 'b') output += '\b';
    else if (next === 'f') output += '\f';
    else if (next === '(' || next === ')' || next === '\\') output += next;
    else if (next === '\n') {
      // PDF line continuation: skip the escaped line break.
    } else if (next === '\r') {
      if (value[index + 2] === '\n') index += 1;
    } else if (/[0-7]/.test(next)) {
      const octal = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? '';
      output += String.fromCharCode(parseInt(octal, 8));
      index += octal.length - 1;
    } else {
      output += next;
    }

    index += 1;
  }

  return output;
}

function decodePdfHexString(value: string): string {
  const bytes = getPdfHexBytes(value);

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }

  const utf16Candidate = bytes.length >= 2 && bytes.length % 2 === 0 ? decodeUtf16Be(bytes) : '';
  return chooseReadableDecode([utf16Candidate, bytes.toString('utf8'), bytes.toString('latin1')]);
}

function getPdfHexBytes(value: string): Buffer {
  const normalized = value.replace(/\s/g, '');
  const evenLengthHex = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  return Buffer.from(evenLengthHex, 'hex');
}

function parsePdfObjects(pdfLatin1: string): PdfObject[] {
  const objects: PdfObject[] = [];
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(pdfLatin1)) !== null) {
    const bodyStart = match.index + match[0].length;
    const objectEnd = pdfLatin1.indexOf('endobj', bodyStart);
    if (objectEnd === -1) continue;

    objects.push({
      id: Number(match[1]),
      generation: Number(match[2]),
      body: pdfLatin1.slice(bodyStart, objectEnd),
      start: match.index,
      bodyStart,
      end: objectEnd + 'endobj'.length,
    });
    objectPattern.lastIndex = objectEnd + 'endobj'.length;
  }

  return objects;
}


function getPdfStreamBuffer(pdfBuffer: Buffer, object: PdfObject): Buffer | null {
  const streamMatch = /stream\r?\n/.exec(object.body);
  if (!streamMatch) return null;

  const streamStartInBody = (streamMatch.index ?? 0) + streamMatch[0].length;
  const streamEndInBody = object.body.indexOf('endstream', streamStartInBody);
  if (streamEndInBody === -1) return null;

  const streamStart = object.bodyStart + streamStartInBody;
  const streamEnd = object.bodyStart + streamEndInBody;
  const rawStream = pdfBuffer.subarray(streamStart, streamEnd);
  const dictionary = object.body.slice(0, streamMatch.index);

  if (/\/Filter\s*(?:\[[^\]]*)?\/FlateDecode/.test(dictionary)) {
    try {
      return inflateSync(rawStream);
    } catch {
      return null;
    }
  }

  if (!/\/Filter\b/.test(dictionary)) {
    return rawStream;
  }

  return null;
}

function parseToUnicodeCMap(cmapText: string): PdfCMap {
  const mappings = new Map<string, string>();

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const match = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (!match) continue;
      mappings.set(match[1].toUpperCase(), decodePdfHexString(match[2]));
    }
  }

  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const line of block[1].split(/\r?\n/)) {
      const arrayMatch = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/);
      if (arrayMatch) {
        const start = parseInt(arrayMatch[1], 16);
        const end = parseInt(arrayMatch[2], 16);
        const width = arrayMatch[1].length;
        const values = Array.from(arrayMatch[3].matchAll(/<([0-9a-fA-F]+)>/g));
        for (let code = start; code <= end && code - start < values.length; code += 1) {
          mappings.set(code.toString(16).toUpperCase().padStart(width, '0'), decodePdfHexString(values[code - start][1]));
        }
        continue;
      }

      const rangeMatch = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (!rangeMatch) continue;

      const start = parseInt(rangeMatch[1], 16);
      const end = parseInt(rangeMatch[2], 16);
      const destinationStart = parseInt(rangeMatch[3], 16);
      const width = rangeMatch[1].length;
      const destinationWidth = rangeMatch[3].length;
      for (let code = start; code <= end; code += 1) {
        const destination = (destinationStart + code - start).toString(16).toUpperCase().padStart(destinationWidth, '0');
        mappings.set(code.toString(16).toUpperCase().padStart(width, '0'), decodePdfHexString(destination));
      }
    }
  }

  const codeLengths = Array.from(new Set(Array.from(mappings.keys()).map((key) => key.length / 2))).sort((left, right) => right - left);
  return { mappings, codeLengths };
}

function decodeBytesWithCMap(bytes: Buffer, cmap?: PdfCMap): string {
  if (!cmap || cmap.mappings.size === 0) {
    return decodePdfHexString(bytes.toString('hex'));
  }

  let output = '';
  for (let index = 0; index < bytes.length;) {
    let matched = false;
    for (const length of cmap.codeLengths) {
      if (index + length > bytes.length) continue;
      const key = bytes.subarray(index, index + length).toString('hex').toUpperCase();
      const mapped = cmap.mappings.get(key);
      if (mapped !== undefined) {
        output += mapped;
        index += length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      output += String.fromCharCode(bytes[index]);
      index += 1;
    }
  }

  return output;
}

function literalStringToBytes(value: string): Buffer {
  return Buffer.from(decodePdfLiteralString(value), 'latin1');
}

function extractStringsFromPdfExpression(expression: string, cmap?: PdfCMap): string[] {
  const strings: string[] = [];
  const tokenPattern = /\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g;
  const matches = expression.matchAll(tokenPattern);

  for (const match of matches) {
    const token = match[0];
    if (token.startsWith('(')) {
      strings.push(decodeBytesWithCMap(literalStringToBytes(token.slice(1, -1)), cmap));
    } else if (match[1]) {
      strings.push(decodeBytesWithCMap(getPdfHexBytes(match[1]), cmap));
    }
  }

  return strings;
}

function extractPdfTextFromContent(content: string, fontCMaps: Map<string, PdfCMap>): string {
  const textParts: string[] = [];
  let currentFont = '';
  const textTokenPattern = /\/(\S+)\s+[\d.]+\s+Tf|(\[(?:[\s\S]*?)\]|\((?:\\.|[^\\)]|\r|\n)*\)|<\s*[0-9a-fA-F\s]+\s*>)\s*(?:Tj|TJ|'|")/g;
  let match: RegExpExecArray | null;

  while ((match = textTokenPattern.exec(content)) !== null) {
    if (match[1]) {
      currentFont = match[1];
      continue;
    }

    const strings = extractStringsFromPdfExpression(match[2], fontCMaps.get(currentFont));
    const text = strings.join('');
    if (text.trim()) {
      textParts.push(text);
    }
  }

  return textParts.join('\n');
}

function getReferencedObjectIds(value: string): number[] {
  return Array.from(value.matchAll(/(\d+)\s+(\d+)\s+R/g)).map((match) => Number(match[1]));
}

function getPageContentObjectIds(pageBody: string): number[] {
  const contentsMatch = pageBody.match(/\/Contents\s+(\[[^\]]+\]|\d+\s+\d+\s+R)/);
  return contentsMatch ? getReferencedObjectIds(contentsMatch[1]) : [];
}

function getPageFontObjectEntries(pageBody: string): Array<[string, number]> {
  const entries: Array<[string, number]> = [];

  for (const fontBlock of pageBody.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) {
    for (const match of fontBlock[1].matchAll(/\/(\S+)\s+(\d+)\s+\d+\s+R/g)) {
      entries.push([match[1], Number(match[2])]);
    }
  }

  return entries;
}

function getInheritedPageBody(page: PdfObject, objectsById: Map<number, PdfObject>): string {
  const inheritedBodies: string[] = [];
  const visited = new Set<number>();
  let currentBody = page.body;

  while (true) {
    const parentId = currentBody.match(/\/Parent\s+(\d+)\s+\d+\s+R/)?.[1];
    if (!parentId) break;

    const parentObjectId = Number(parentId);
    if (visited.has(parentObjectId)) break;
    visited.add(parentObjectId);

    const parent = objectsById.get(parentObjectId);
    if (!parent) break;

    inheritedBodies.unshift(parent.body);
    currentBody = parent.body;
  }

  return `${inheritedBodies.join('\n')}\n${page.body}`;
}

function buildFontCMapsForPage(
  pageBody: string,
  objectsById: Map<number, PdfObject>,
  streamTextByObjectId: Map<number, string>,
): Map<string, PdfCMap> {
  const fontCMaps = new Map<string, PdfCMap>();

  for (const [fontName, fontObjectId] of getPageFontObjectEntries(pageBody)) {
    const fontObject = objectsById.get(fontObjectId);
    const toUnicodeObjectId = fontObject?.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/)?.[1];
    if (!toUnicodeObjectId) continue;

    const cmapText = streamTextByObjectId.get(Number(toUnicodeObjectId));
    if (cmapText) {
      fontCMaps.set(fontName, parseToUnicodeCMap(cmapText));
    }
  }

  return fontCMaps;
}

function extractPdfText(buffer: Buffer): PdfExtractionResult {
  const pdfLatin1 = buffer.toString('latin1');
  const objects = parsePdfObjects(pdfLatin1);
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const streamTextByObjectId = new Map<number, string>();

  for (const object of objects) {
    const stream = getPdfStreamBuffer(buffer, object);
    if (stream) {
      streamTextByObjectId.set(object.id, stream.toString('latin1'));
    }
  }

  const pages = objects.filter((object) => /\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body));
  const pageExtractions: PdfPageExtraction[] = pages.map((page, index) => {
    const pageBodyWithInheritedResources = getInheritedPageBody(page, objectsById);
    const fontCMaps = buildFontCMapsForPage(pageBodyWithInheritedResources, objectsById, streamTextByObjectId);
    const text = getPageContentObjectIds(page.body)
      .map((contentObjectId) => streamTextByObjectId.get(contentObjectId) ?? '')
      .map((content) => extractPdfTextFromContent(content, fontCMaps))
      .filter(Boolean)
      .join('\n');

    return { pageNumber: index + 1, text: text.trim() };
  });

  const fallbackText = extractPdfTextFromContent(pdfLatin1, new Map()).trim();
  const effectiveExtractions = pageExtractions.length
    ? pageExtractions
    : [{ pageNumber: 1, text: fallbackText }];

  const extractedPages = effectiveExtractions.filter((page) => page.text.trim().length > 0);
  const pageText = extractedPages
    .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
    .join('\n\n');

  return {
    text: pageText || fallbackText,
    pageCount: effectiveExtractions.length,
    extractedPageCount: extractedPages.length,
    emptyPageCount: Math.max(effectiveExtractions.length - extractedPages.length, 0),
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드된 파일을 찾을 수 없습니다.' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: '파일 크기가 너무 큽니다. 10MB 이하 파일을 업로드해주세요.' }, { status: 413 });
    }

    const extension = getExtension(file.name);
    if (!supportedExtensions.includes(extension as SupportedExtension)) {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다. PDF 또는 DOCX 파일을 업로드해주세요.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (extension === 'docx') {
      const validation = validateExtractedText(await extractDocxText(buffer));

      if (!validation.ok) {
        const key = validation.reason === 'short' ? 'warning' : 'error';
        return NextResponse.json({ [key]: validation.message }, { status: 422 });
      }

      return NextResponse.json({ text: validation.text });
    }

    const pdfExtraction = extractPdfText(buffer);
    const qualityAssessment = assessExtractedTextQuality(pdfExtraction.text, file.size);
    const validation = validateExtractedText(pdfExtraction.text);

    if (!validation.ok || qualityAssessment.isLowQuality) {
      return NextResponse.json(
        {
          warning: OCR_UNSUPPORTED_MESSAGE,
          ocrNotice: OCR_UNSUPPORTED_MESSAGE,
          qualityReasons: qualityAssessment.reasons,
          pageCount: pdfExtraction.pageCount,
          extractedPageCount: pdfExtraction.extractedPageCount,
          extractedCharCount: qualityAssessment.charCount,
        },
        { status: 422 },
      );
    }

    const isPartial = pdfExtraction.emptyPageCount > 0 && pdfExtraction.extractedPageCount > 0;
    return NextResponse.json({
      text: validation.text,
      status: isPartial ? 'partial' : 'success',
      message: isPartial ? PDF_TEXT_EXTRACTION_PARTIAL_SUCCESS_MESSAGE : PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE,
      ocrNotice: isPartial ? OCR_UNSUPPORTED_MESSAGE : undefined,
      pageCount: pdfExtraction.pageCount,
      extractedPageCount: pdfExtraction.extractedPageCount,
    });
  } catch {
    return NextResponse.json({ error: TEXT_EXTRACTION_FAILED_MESSAGE }, { status: 500 });
  }
}
