import { DEFAULT_VISION_PAGE_LIMIT } from './visionConfig';

export const MIN_EXTRACTED_TEXT_LENGTH = 100;

export const MIN_SUFFICIENT_EXTRACTED_TEXT_LENGTH = 300;

export const TEXT_EXTRACTION_FAILED_MESSAGE =
  "텍스트를 추출할 수 없습니다. 스캔본 또는 이미지 중심 자료일 수 있습니다.";
export const SHORT_EXTRACTED_TEXT_MESSAGE =
  "추출된 텍스트가 부족합니다. 파일이 스캔본이거나 이미지 중심 자료일 수 있습니다.";
export const PDF_TEXT_EXTRACTION_SUCCESS_MESSAGE =
  "PDF에서 텍스트를 추출했습니다.";
export const PDF_TEXT_EXTRACTION_PARTIAL_SUCCESS_MESSAGE =
  "일부 페이지는 이미지 중심이라 텍스트 추출이 제한되었지만, 추출 가능한 텍스트를 사용합니다.";
export const OCR_UNSUPPORTED_MESSAGE =
  "텍스트 추출 실패 · 이미지 중심 PDF 가능성 높음 · OCR 필요";
export const OCR_PROCESSING_GUIDANCE =
  "이미지 중심 PDF는 OCR 처리에 시간이 걸릴 수 있습니다. 페이지 수가 많을 경우 일부 페이지만 먼저 처리하는 것을 권장합니다.";
export const OCR_FIRST_10_PAGES_LABEL = "앞 10페이지 OCR";
export const VISION_REQUIRED_MESSAGE =
  "텍스트 품질 낮음 · 이미지 중심 PDF로 판단 · Vision 분석 자동 실행";
export const VISION_PROCESSING_GUIDANCE =
  `이미지 중심 PDF로 판단되어 앞 ${DEFAULT_VISION_PAGE_LIMIT}페이지를 자동 분석 중입니다. Vision 분석에는 시간이 걸릴 수 있습니다.`;
export const VISION_PROCESSING_PAGE_LIMIT_MESSAGE =
  `페이지 수가 많은 문서는 MVP에서 앞 ${DEFAULT_VISION_PAGE_LIMIT}페이지만 우선 분석합니다.`;
export const VISION_FIRST_3_PAGES_LABEL = `앞 ${DEFAULT_VISION_PAGE_LIMIT}페이지 Vision 분석`;

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

function getReadableCharacterCount(value: string): number {
  return Array.from(value).filter((character) =>
    /[\p{Script=Hangul}\p{Script=Latin}\p{Number}]/u.test(character),
  ).length;
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
  const hasSufficientReadableText =
    text.length >= MIN_SUFFICIENT_EXTRACTED_TEXT_LENGTH &&
    getReadableCharacterCount(text) >= MIN_SUFFICIENT_EXTRACTED_TEXT_LENGTH * 0.45;

  if (
    !hasSufficientReadableText &&
    (quality.controlRatio > 0.03 ||
      quality.replacementRatio > 0.02 ||
      quality.readableRatio < 0.55)
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


export type ExtractedTextQualityAssessment = {
  normalizedText: string;
  charCount: number;
  readableRatio: number;
  replacementRatio: number;
  controlRatio: number;
  readableAlphaNumericCount: number;
  textToFileSizeRatio: number;
  isLowQuality: boolean;
  reasons: string[];
};

export function assessExtractedTextQuality(
  value: string,
  fileSizeBytes: number,
): ExtractedTextQualityAssessment {
  const normalizedText = normalizeExtractedText(value);
  const quality = getTextQuality(normalizedText);
  const charCount = normalizedText.length;
  const readableAlphaNumericCount = getReadableCharacterCount(normalizedText);
  const readableAlphaNumericRatio = readableAlphaNumericCount / Math.max(charCount, 1);
  const textToFileSizeRatio = charCount / Math.max(fileSizeBytes, 1);
  const reasons: string[] = [];

  if (charCount < MIN_EXTRACTED_TEXT_LENGTH) {
    reasons.push("추출 글자 수가 너무 적음");
  }

  if (quality.replacementRatio > 0.02 || quality.controlRatio > 0.03) {
    reasons.push("깨진 문자 비율이 높음");
  }

  if (readableAlphaNumericRatio < 0.35 || quality.readableRatio < 0.55) {
    reasons.push("한글/영문/숫자 비율이 비정상적으로 낮음");
  }

  if (fileSizeBytes >= 300 * 1024 && textToFileSizeRatio < 0.0008) {
    reasons.push("PDF 파일 크기 대비 추출 텍스트가 지나치게 적음");
  }

  return {
    normalizedText,
    charCount,
    readableRatio: quality.readableRatio,
    replacementRatio: quality.replacementRatio,
    controlRatio: quality.controlRatio,
    readableAlphaNumericCount,
    textToFileSizeRatio,
    isLowQuality: reasons.length > 0,
    reasons,
  };
}
