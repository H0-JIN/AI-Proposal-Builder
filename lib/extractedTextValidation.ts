export const MIN_EXTRACTED_TEXT_LENGTH = 100;

export const TEXT_EXTRACTION_FAILED_MESSAGE =
  "파일에서 텍스트를 추출하지 못했습니다. 텍스트를 직접 입력해주세요.";
export const SHORT_EXTRACTED_TEXT_MESSAGE =
  "추출된 텍스트가 부족합니다. 파일이 스캔본이거나 이미지 중심 자료일 수 있습니다.";

const binarySignaturePatterns = [
  /^%PDF/i,
  /^PK(?:\u0003\u0004|\u0005\u0006|\u0007\u0008|\s|$)/,
  /^\u0089PNG/,
  /^GIF8[79]a/,
  /^\u00ff\u00d8\u00ff/,
  /^Rar!\u001a\u0007/,
  /^7z\u00bc\u00af\u0027\u001c/,
];

export type ExtractedTextValidationResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: "empty" | "short" | "binary";
      text: string;
      message: string;
    };

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasBinarySignature(value: string): boolean {
  const firstChunk = value.slice(0, 32).trimStart();
  return binarySignaturePatterns.some((pattern) => pattern.test(firstChunk));
}

function getTextQuality(value: string) {
  const characters = Array.from(value);
  const total = characters.length || 1;
  let readableCharacters = 0;
  let controlCharacters = 0;
  let replacementCharacters = 0;

  for (const character of characters) {
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(character)
    ) {
      controlCharacters += 1;
      continue;
    }

    if (character === "\ufffd") {
      replacementCharacters += 1;
      continue;
    }

    if (
      /^[\p{Script=Hangul}\p{Script=Latin}\p{Number}\s.,!?;:'"“”‘’()\[\]{}<>/@#%&*+\-=~_|\\…·ㆍ•\-–—、。·]+$/u.test(
        character,
      )
    ) {
      readableCharacters += 1;
    }
  }

  return {
    readableRatio: readableCharacters / total,
    controlRatio: controlCharacters / total,
    replacementRatio: replacementCharacters / total,
  };
}

export function validateExtractedText(
  value: string,
): ExtractedTextValidationResult {
  const text = normalizeExtractedText(value);

  if (!text) {
    return {
      ok: false,
      reason: "empty",
      text,
      message: TEXT_EXTRACTION_FAILED_MESSAGE,
    };
  }

  if (hasBinarySignature(text)) {
    return {
      ok: false,
      reason: "binary",
      text,
      message: TEXT_EXTRACTION_FAILED_MESSAGE,
    };
  }

  const quality = getTextQuality(text);
  if (
    quality.controlRatio > 0.01 ||
    quality.replacementRatio > 0.005 ||
    quality.readableRatio < 0.75
  ) {
    return {
      ok: false,
      reason: "binary",
      text,
      message: TEXT_EXTRACTION_FAILED_MESSAGE,
    };
  }

  if (text.length < MIN_EXTRACTED_TEXT_LENGTH) {
    return {
      ok: false,
      reason: "short",
      text,
      message: SHORT_EXTRACTED_TEXT_MESSAGE,
    };
  }

  return { ok: true, text };
}
