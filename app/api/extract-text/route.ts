import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { inflateSync } from 'node:zlib';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_EXTRACTED_TEXT_LENGTH = 100;
const supportedExtensions = ['pdf', 'docx'] as const;
const genericExtractionFailureMessage = '파일에서 텍스트를 추출하지 못했습니다. 텍스트를 직접 입력해주세요.';
const shortExtractedTextWarningMessage = '추출된 텍스트가 부족합니다. 파일이 스캔본이거나 이미지 중심 자료일 수 있습니다.';

type SupportedExtension = (typeof supportedExtensions)[number];

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function getUploadedExtension(file: File): string {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';

  return getExtension(file.name);
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasExpectedFileSignature(buffer: Buffer, extension: SupportedExtension) {
  if (extension === 'pdf') return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  return buffer.subarray(0, 2).toString('latin1') === 'PK';
}

function getTextValidityIssue(text: string) {
  const trimmedText = text.trim();
  const firstChunk = trimmedText.slice(0, 16);

  if (/^(%PDF|PK\u0003\u0004|PK\u0005\u0006|PK\u0007\u0008)/.test(firstChunk)) {
    return genericExtractionFailureMessage;
  }

  if (trimmedText.length < MIN_EXTRACTED_TEXT_LENGTH) {
    return shortExtractedTextWarningMessage;
  }

  const nonWhitespaceChars = Array.from(trimmedText).filter((character) => !/\s/.test(character));
  if (!nonWhitespaceChars.length) return genericExtractionFailureMessage;

  const readableChars = nonWhitespaceChars.filter((character) => /[A-Za-z0-9가-힣ㄱ-ㅎㅏ-ㅣ.,!?;:'"()\[\]{}<>/@#$%^&*_=+\-~`|\\·…•、。！？；：，.《》〈〉「」『』\u2010-\u2015\u2018-\u201D\u3000]/u.test(character));
  const suspiciousChars = nonWhitespaceChars.filter((character) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/u.test(character));
  const readableRatio = readableChars.length / nonWhitespaceChars.length;
  const suspiciousRatio = suspiciousChars.length / nonWhitespaceChars.length;

  if (readableRatio < 0.65 || suspiciousRatio > 0.02) {
    return genericExtractionFailureMessage;
  }

  return '';
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

  return normalizeText(text);
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
    else if (/[0-7]/.test(next)) {
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
  const normalized = value.replace(/\s/g, '');
  const evenLengthHex = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
  const bytes = Buffer.from(evenLengthHex, 'hex');

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const codePoints: number[] = [];
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      codePoints.push(bytes[index] * 256 + bytes[index + 1]);
    }
    return String.fromCharCode(...codePoints);
  }

  return bytes.toString('latin1');
}

function extractStringsFromPdfExpression(expression: string): string[] {
  const strings: string[] = [];
  const tokenPattern = /\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g;
  const matches = expression.matchAll(tokenPattern);

  for (const match of matches) {
    const token = match[0];
    if (token.startsWith('(')) {
      strings.push(decodePdfLiteralString(token.slice(1, -1)));
    } else if (match[1]) {
      strings.push(decodePdfHexString(match[1]));
    }
  }

  return strings;
}

function extractPdfTextFromContent(content: string): string {
  const textParts: string[] = [];
  const textOperatorPattern = /(\[(?:[\s\S]*?)\]|\((?:\\.|[^\\)])*\)|<\s*[0-9a-fA-F\s]+\s*>)\s*(?:Tj|TJ|'|")/g;
  const matches = content.matchAll(textOperatorPattern);

  for (const match of matches) {
    const strings = extractStringsFromPdfExpression(match[1]);
    if (strings.length) {
      textParts.push(strings.join(''));
    }
  }

  return textParts.join('\n');
}

function getPdfStreamBuffers(pdfBuffer: Buffer, pdfLatin1: string): Buffer[] {
  const streams: Buffer[] = [];
  const streamPattern = /stream\r?\n/g;
  const matches = pdfLatin1.matchAll(streamPattern);

  for (const match of matches) {
    const start = (match.index ?? 0) + match[0].length;
    const end = pdfLatin1.indexOf('endstream', start);
    if (end === -1) continue;

    const dictionaryStart = pdfLatin1.lastIndexOf('<<', match.index);
    const dictionaryEnd = pdfLatin1.lastIndexOf('>>', match.index);
    const dictionary = dictionaryStart !== -1 && dictionaryEnd !== -1 && dictionaryEnd > dictionaryStart
      ? pdfLatin1.slice(dictionaryStart, dictionaryEnd)
      : '';
    const rawStream = pdfBuffer.subarray(start, end);

    if (/\/Filter\s*\/FlateDecode/.test(dictionary)) {
      try {
        streams.push(inflateSync(rawStream));
      } catch {
        // Ignore streams that cannot be inflated and continue scanning the PDF.
      }
    } else if (!/\/Filter\b/.test(dictionary)) {
      streams.push(rawStream);
    }
  }

  return streams;
}

function extractPdfText(buffer: Buffer): string {
  const pdfLatin1 = buffer.toString('latin1');
  const streamText = getPdfStreamBuffers(buffer, pdfLatin1)
    .map((stream) => extractPdfTextFromContent(stream.toString('latin1')))
    .filter(Boolean)
    .join('\n');

  const fallbackText = extractPdfTextFromContent(pdfLatin1);
  return normalizeText(`${streamText}\n${fallbackText}`);
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

    const extension = getUploadedExtension(file);
    if (!supportedExtensions.includes(extension as SupportedExtension)) {
      return NextResponse.json({ error: '지원하지 않는 파일 형식입니다. PDF 또는 DOCX 파일을 업로드해주세요.' }, { status: 400 });
    }

    const supportedExtension = extension as SupportedExtension;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!hasExpectedFileSignature(buffer, supportedExtension)) {
      return NextResponse.json({ error: genericExtractionFailureMessage }, { status: 422 });
    }

    const text = supportedExtension === 'docx' ? await extractDocxText(buffer) : extractPdfText(buffer);
    const validityIssue = getTextValidityIssue(text);

    if (validityIssue) {
      return NextResponse.json({ error: validityIssue }, { status: 422 });
    }

    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: genericExtractionFailureMessage }, { status: 500 });
  }
}
