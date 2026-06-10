import { DEFAULT_VISION_CHUNK_SIZE } from './visionConfig';

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
export const TEXT_EXTRACTION_LOW_QUALITY_MESSAGE =
  "텍스트 추출 품질 낮음";
export const ENCODING_CORRUPTION_DETECTED_MESSAGE =
  "인코딩 깨짐 감지";
export const VISION_FALLBACK_IN_PROGRESS_MESSAGE =
  "Vision 분석으로 전환 중";
export const VISION_FALLBACK_COMPLETED_MESSAGE =
  "텍스트 추출 품질 낮음 → Vision 분석 완료";
export const VISION_CHUNK_CREATION_MESSAGE =
  "Vision 기반 chunk 생성";
export const VISION_PROCESSING_GUIDANCE =
  `이미지 중심 PDF로 판단되어 전체 페이지를 ${DEFAULT_VISION_CHUNK_SIZE}페이지 단위로 자동 분석 중입니다. Vision 분석에는 시간이 걸릴 수 있습니다.`;
export const VISION_PROCESSING_PAGE_LIMIT_MESSAGE =
  `전체 페이지 Vision 분석 · ${DEFAULT_VISION_CHUNK_SIZE}페이지 단위 순차 처리`;
export const VISION_FULL_CHUNKED_LABEL = `전체 페이지 Vision 분석 · ${DEFAULT_VISION_CHUNK_SIZE}페이지 단위 순차 처리`;
export const VISION_FIRST_3_PAGES_LABEL = VISION_FULL_CHUNKED_LABEL;

const mojibakeCharacterPattern = /[ÃÂâÑÇìíêë]/u;
const mojibakeSequencePattern = /(?:[ÃÂâÑÇìíêë][\u0080-\u00ff\ufffd]?|\ufffd){2,}/gu;
const repeatedSpecialPattern = /[^\p{Script=Hangul}\p{Script=Latin}\p{Number}\s]{4,}|□{2,}/gu;
const sentenceBoundaryPattern = /[.!?。！？]|\n+/g;

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
      reason: "empty" | "short" | "binary" | "lowQuality" | "encodingCorruption";
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

function countCharacters(value: string, pattern: RegExp): number {
  return Array.from(value).filter((character) => pattern.test(character)).length;
}

function getReadableCharacterCount(value: string): number {
  return countCharacters(value, /[\p{Script=Hangul}\p{Script=Latin}\p{Number}]/u);
}

function countPatternCharacters(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).reduce((count, match) => count + match[0].length, 0);
}

function getMeaningfulSentenceRatio(value: string): number {
  const sentences = value
    .split(sentenceBoundaryPattern)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!sentences.length) return 0;

  const meaningfulSentences = sentences.filter((sentence) => {
    const sentenceLength = Math.max(Array.from(sentence).length, 1);
    const readableCount = getReadableCharacterCount(sentence);
    const mojibakeCount = countCharacters(sentence, mojibakeCharacterPattern) + (sentence.match(/\ufffd/g)?.length ?? 0);
    return readableCount >= 8 && readableCount / sentenceLength >= 0.45 && mojibakeCount / sentenceLength < 0.08;
  });

  return meaningfulSentences.length / sentences.length;
}

function getTextQuality(value: string) {
  const characters = Array.from(value);
  const total = characters.length || 1;
  let readableCharacters = 0;
  let controlCharacters = 0;
  let replacementCharacters = 0;
  let mojibakeCharacters = 0;
  let hangulCharacters = 0;
  let latinCharacters = 0;
  let numberCharacters = 0;
  let boxCharacters = 0;

  for (const character of characters) {
    if (/\p{Script=Hangul}/u.test(character)) hangulCharacters += 1;
    if (/\p{Script=Latin}/u.test(character)) latinCharacters += 1;
    if (/\p{Number}/u.test(character)) numberCharacters += 1;
    if (character === '□') boxCharacters += 1;
    if (mojibakeCharacterPattern.test(character)) mojibakeCharacters += 1;

    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(character)) {
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

  const mojibakeSequenceCharacters = countPatternCharacters(value, mojibakeSequencePattern);
  const repeatedSpecialCharacters = countPatternCharacters(value, repeatedSpecialPattern);
  const hangulLatinNumberCount = hangulCharacters + latinCharacters + numberCharacters;
  const koreanLikely =
    hangulCharacters > 20 ||
    mojibakeSequenceCharacters / total > 0.01 ||
    /[가-힣]|(?:ì|í|ê|ë|Ã|Â|â){2,}/u.test(value);

  return {
    readableRatio: readableCharacters / total,
    controlRatio: controlCharacters / total,
    replacementRatio: replacementCharacters / total,
    mojibakeRatio: (mojibakeCharacters + mojibakeSequenceCharacters) / total,
    brokenCharacterRatio: (replacementCharacters + controlCharacters + boxCharacters) / total,
    repeatedSpecialRatio: repeatedSpecialCharacters / total,
    hangulRatio: hangulCharacters / total,
    latinRatio: latinCharacters / total,
    numberRatio: numberCharacters / total,
    hangulLatinNumberRatio: hangulLatinNumberCount / total,
    meaningfulSentenceRatio: getMeaningfulSentenceRatio(value),
    boxCharacterRatio: boxCharacters / total,
    koreanLikely,
  };
}

function getLowQualityReasons(value: string, fileSizeBytes?: number): string[] {
  const quality = getTextQuality(value);
  const charCount = value.length;
  const textToFileSizeRatio = fileSizeBytes === undefined ? 1 : charCount / Math.max(fileSizeBytes, 1);
  const reasons: string[] = [];

  if (charCount < MIN_EXTRACTED_TEXT_LENGTH) {
    reasons.push("추출 글자 수가 너무 적음");
  }

  if (quality.mojibakeRatio > 0.015) {
    reasons.push("mojibake 문자 비율이 높음");
  }

  if (quality.replacementRatio > 0.01 || quality.controlRatio > 0.03 || quality.brokenCharacterRatio > 0.025 || quality.boxCharacterRatio > 0.01) {
    reasons.push("깨진 문자 비율이 높음");
  }

  if (quality.hangulLatinNumberRatio < 0.35 || quality.readableRatio < 0.55) {
    reasons.push("한글/영문/숫자 비율이 비정상적으로 낮음");
  }

  if (quality.meaningfulSentenceRatio < 0.2 && charCount >= MIN_SUFFICIENT_EXTRACTED_TEXT_LENGTH) {
    reasons.push("의미 있는 문장 비율이 낮음");
  }

  if (quality.repeatedSpecialRatio > 0.03) {
    reasons.push("반복되는 특수문자 비율이 높음");
  }

  if (quality.koreanLikely && quality.hangulRatio < 0.05 && (quality.mojibakeRatio > 0.005 || quality.replacementRatio > 0.005)) {
    reasons.push("한국어 PDF로 추정되지만 한글 비율이 낮고 인코딩 깨짐이 감지됨");
  }

  if (fileSizeBytes !== undefined && fileSizeBytes >= 300 * 1024 && textToFileSizeRatio < 0.0008) {
    reasons.push("PDF 파일 크기 대비 추출 텍스트가 지나치게 적음");
  }

  return Array.from(new Set(reasons));
}


export function validateDirectTextInput(
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

  const characters = Array.from(text);
  const replacementCount = characters.filter((character) => character === "\ufffd").length;
  const readableCount = getReadableCharacterCount(text);
  const replacementRatio = replacementCount / Math.max(characters.length, 1);

  if (replacementRatio >= 0.3 || (replacementCount > 20 && replacementCount > readableCount)) {
    return {
      ok: false,
      reason: "encodingCorruption",
      text,
      message: [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE].join(' · '),
    };
  }

  if (readableCount === 0) {
    return {
      ok: false,
      reason: "empty",
      text,
      message: TEXT_EXTRACTION_FAILED_MESSAGE,
    };
  }

  return { ok: true, text };
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

  const lowQualityReasons = getLowQualityReasons(text);
  if (lowQualityReasons.some((reason) => /mojibake|깨진|인코딩|한국어|특수문자|문장/.test(reason))) {
    return {
      ok: false,
      reason: lowQualityReasons.some((reason) => /mojibake|인코딩|한국어/.test(reason)) ? "encodingCorruption" : "lowQuality",
      text,
      message: [TEXT_EXTRACTION_LOW_QUALITY_MESSAGE, ENCODING_CORRUPTION_DETECTED_MESSAGE].join(' · '),
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
  mojibakeRatio: number;
  brokenCharacterRatio: number;
  hangulRatio: number;
  latinRatio: number;
  numberRatio: number;
  hangulLatinNumberRatio: number;
  meaningfulSentenceRatio: number;
  repeatedSpecialRatio: number;
  readableAlphaNumericCount: number;
  textToFileSizeRatio: number;
  koreanLikely: boolean;
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
  const textToFileSizeRatio = charCount / Math.max(fileSizeBytes, 1);
  const reasons = getLowQualityReasons(normalizedText, fileSizeBytes);

  return {
    normalizedText,
    charCount,
    readableRatio: quality.readableRatio,
    replacementRatio: quality.replacementRatio,
    controlRatio: quality.controlRatio,
    mojibakeRatio: quality.mojibakeRatio,
    brokenCharacterRatio: quality.brokenCharacterRatio,
    hangulRatio: quality.hangulRatio,
    latinRatio: quality.latinRatio,
    numberRatio: quality.numberRatio,
    hangulLatinNumberRatio: quality.hangulLatinNumberRatio,
    meaningfulSentenceRatio: quality.meaningfulSentenceRatio,
    repeatedSpecialRatio: quality.repeatedSpecialRatio,
    readableAlphaNumericCount,
    textToFileSizeRatio,
    koreanLikely: quality.koreanLikely,
    isLowQuality: reasons.length > 0,
    reasons,
  };
}

export type ExtractedPageQualityAssessment = ExtractedTextQualityAssessment & {
  pageNumber: number;
  text: string;
  useVision: boolean;
};

export function assessExtractedPdfPages(
  pages: { pageNumber: number; text: string }[],
  fileSizeBytes: number,
): ExtractedPageQualityAssessment[] {
  const approximatePageSize = Math.max(Math.round(fileSizeBytes / Math.max(pages.length, 1)), 1);

  return pages.map((page) => {
    const assessment = assessExtractedTextQuality(page.text, approximatePageSize);
    const lowTextDensity = assessment.charCount < MIN_EXTRACTED_TEXT_LENGTH;
    const imageOrTableLikely = assessment.charCount < MIN_SUFFICIENT_EXTRACTED_TEXT_LENGTH && assessment.hangulLatinNumberRatio < 0.45;
    const koreanEncodingRisk = assessment.koreanLikely && assessment.hangulRatio < 0.05 && (assessment.mojibakeRatio > 0.005 || assessment.replacementRatio > 0.005);
    const useVision = assessment.isLowQuality || lowTextDensity || imageOrTableLikely || koreanEncodingRisk;
    const reasons = [
      ...assessment.reasons,
      lowTextDensity ? '페이지 추출 글자 수가 너무 적음' : undefined,
      imageOrTableLikely ? '표/이미지 중심 페이지로 판단됨' : undefined,
      koreanEncodingRisk ? '한국어 문서로 추정되지만 한글 비율이 낮음' : undefined,
    ].filter(Boolean) as string[];

    return {
      ...assessment,
      pageNumber: page.pageNumber,
      text: assessment.normalizedText,
      useVision,
      isLowQuality: useVision,
      reasons: Array.from(new Set(reasons)),
    };
  });
}

export function sanitizeCorruptedText(value: string): string {
  return normalizeExtractedText(value)
    .replace(mojibakeSequencePattern, ' ')
    .replace(/[ÃÂâÑÇìíêë\ufffd]+/gu, ' ')
    .replace(/□{2,}/g, ' ')
    .replace(/([^\p{Script=Hangul}\p{Script=Latin}\p{Number}\s])\1{3,}/gu, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isUsableRagText(value: string): boolean {
  const normalizedText = normalizeExtractedText(value);
  if (normalizedText.length < 20) return false;
  return getLowQualityReasons(normalizedText).length === 0;
}
