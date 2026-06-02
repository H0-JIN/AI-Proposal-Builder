import { NextResponse } from 'next/server';
import {
  TEXT_EXTRACTION_FAILED_MESSAGE,
  VISION_PROCESSING_GUIDANCE,
  VISION_PROCESSING_PAGE_LIMIT_MESSAGE,
  validateExtractedText,
} from '@/lib/extractedTextValidation';
import { getOpenAIClient } from '@/lib/openai';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 10;

export const maxDuration = 60;

type VisionMode = 'first10';

type VisionErrorCode =
  | 'PDF_RECEIVE_FAILED'
  | 'PDF_IMAGE_CONVERSION_FAILED'
  | 'OPENAI_VISION_API_FAILED'
  | 'OPENAI_RESPONSE_PARSE_FAILED'
  | 'VISION_ANALYSIS_EMPTY'
  | 'VERCEL_TIMEOUT_RISK'
  | 'UNKNOWN_SERVER_ERROR';

type VisionJsonPayload = {
  ok: boolean;
  error?: VisionErrorCode;
  message: string;
  details?: string;
  text?: string;
  documentAnalysisText?: string;
  pages?: VisionPageAnalysis[];
  charCount?: number;
  pageCount?: number;
  processedPageCount?: number;
  status?: 'success' | 'partial' | 'failed';
  guidance?: string;
};

const VISION_ROUTE_TIMEOUT_MS = 52_000;

function jsonSuccess(payload: Omit<VisionJsonPayload, 'ok'>, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

function jsonFailure(error: VisionErrorCode, message: string, details?: string, status = 500, extra: Partial<VisionJsonPayload> = {}) {
  return NextResponse.json(
    {
      ok: false,
      error,
      message,
      details,
      status: 'failed',
      pages: [],
      charCount: 0,
      processedPageCount: 0,
      guidance: VISION_PROCESSING_GUIDANCE,
      ...extra,
    },
    { status },
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Vercel 실행 시간 초과 가능성: Vision 분석이 ${Math.round(timeoutMs / 1000)}초 안에 완료되지 않았습니다.`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}


type VisionPageAnalysis = {
  pageNumber: number;
  extractedText: string;
  visualSummary: string;
  detectedTables: string[];
  detectedDiagrams: string[];
  floorplanOrLayoutInfo: string;
  keyRequirements: string[];
  constraints: string[];
  scheduleInfo: string[];
  operationInfo: string[];
  designOrVisualReferences: string[];
  confidence: number;
  needsReview: boolean;
};

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function getPageCount(buffer: Buffer): number | undefined {
  const pdfLatin1 = buffer.toString('latin1');
  const pageMatches = pdfLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
  return pageMatches?.length;
}

function safeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function normalizePageAnalysis(value: unknown, fallbackPageNumber: number): VisionPageAnalysis {
  const page = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const confidence = Number(page.confidence);

  return {
    pageNumber: Number(page.pageNumber) || fallbackPageNumber,
    extractedText: String(page.extractedText ?? '').trim(),
    visualSummary: String(page.visualSummary ?? '').trim(),
    detectedTables: safeArray(page.detectedTables),
    detectedDiagrams: safeArray(page.detectedDiagrams),
    floorplanOrLayoutInfo: String(page.floorplanOrLayoutInfo ?? '').trim(),
    keyRequirements: safeArray(page.keyRequirements),
    constraints: safeArray(page.constraints),
    scheduleInfo: safeArray(page.scheduleInfo),
    operationInfo: safeArray(page.operationInfo),
    designOrVisualReferences: safeArray(page.designOrVisualReferences),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    needsReview: Boolean(page.needsReview),
  };
}

function parseVisionJson(outputText: string): VisionPageAnalysis[] {
  const cleaned = outputText
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned) as { pages?: unknown[] } | unknown[];
  const pages = Array.isArray(parsed) ? parsed : parsed.pages;

  if (!Array.isArray(pages)) {
    throw new Error('Vision 분석 응답 형식이 올바르지 않습니다.');
  }

  return pages.map((page, index) => normalizePageAnalysis(page, index + 1));
}

function buildDocumentAnalysisText(pages: VisionPageAnalysis[]): string {
  return pages
    .map((page) => {
      const blocks = [
        `[Vision Page ${page.pageNumber}]`,
        page.extractedText ? `보이는 텍스트:\n${page.extractedText}` : undefined,
        page.visualSummary ? `시각 요약: ${page.visualSummary}` : undefined,
        page.detectedTables.length ? `표/일정표:\n- ${page.detectedTables.join('\n- ')}` : undefined,
        page.detectedDiagrams.length ? `도식/다이어그램:\n- ${page.detectedDiagrams.join('\n- ')}` : undefined,
        page.floorplanOrLayoutInfo ? `평면도/좌석/동선/공간 정보: ${page.floorplanOrLayoutInfo}` : undefined,
        page.keyRequirements.length ? `주요 요구사항:\n- ${page.keyRequirements.join('\n- ')}` : undefined,
        page.constraints.length ? `제약 조건:\n- ${page.constraints.join('\n- ')}` : undefined,
        page.scheduleInfo.length ? `일정 정보:\n- ${page.scheduleInfo.join('\n- ')}` : undefined,
        page.operationInfo.length ? `운영 조건:\n- ${page.operationInfo.join('\n- ')}` : undefined,
        page.designOrVisualReferences.length ? `디자인/참고 이미지 방향:\n- ${page.designOrVisualReferences.join('\n- ')}` : undefined,
        `신뢰도: ${page.confidence.toFixed(2)}${page.needsReview ? ' · 검토 필요' : ''}`,
      ];

      return blocks.filter(Boolean).join('\n');
    })
    .join('\n\n');
}

export async function POST(request: Request) {
  console.info('vision analysis started', { route: '/api/vision-pdf' });

  let fileName = 'unknown.pdf';
  let pageCount: number | undefined;

  try {
    let formData: FormData;
    let file: FormDataEntryValue | null;
    let mode: VisionMode;

    try {
      formData = await request.formData();
      file = formData.get('file');
      mode = (formData.get('mode')?.toString() || 'first10') as VisionMode;
    } catch (receiveError) {
      const details = getErrorMessage(receiveError, 'PDF 파일 수신 중 알 수 없는 오류가 발생했습니다.');
      console.error('pdf receive failed', { error: details });
      return jsonFailure('PDF_RECEIVE_FAILED', 'PDF 파일 수신에 실패했습니다.', details, 400);
    }

    if (!(file instanceof File)) {
      console.error('pdf receive failed', { error: 'file field is missing or invalid' });
      return jsonFailure('PDF_RECEIVE_FAILED', '업로드된 PDF 파일을 찾을 수 없습니다.', 'FormData에 file 필드가 없거나 파일 형식이 아닙니다.', 400);
    }

    fileName = file.name;
    console.info('pdf received', { fileName, fileSize: file.size, mode });

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return jsonFailure('PDF_RECEIVE_FAILED', '파일 크기가 너무 큽니다. 10MB 이하 PDF를 업로드해주세요.', `${file.size} bytes`, 413);
    }

    if (getExtension(file.name) !== 'pdf') {
      return jsonFailure('PDF_RECEIVE_FAILED', 'Vision 분석은 PDF 파일만 지원합니다.', `received extension: ${getExtension(file.name) || 'none'}`, 400);
    }

    if (mode !== 'first10') {
      return jsonFailure('PDF_RECEIVE_FAILED', '현재 MVP에서는 앞 10페이지 Vision 분석만 지원합니다.', `received mode: ${mode}`, 400);
    }

    let buffer: Buffer;
    let processedPageCount: number;
    try {
      console.info('pdf image conversion started', { fileName, mode });
      buffer = Buffer.from(await file.arrayBuffer());
      pageCount = getPageCount(buffer);
      processedPageCount = Math.min(pageCount ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
      console.info('pdf image conversion completed', { fileName, pageCount, processedPageCount });
    } catch (conversionError) {
      const details = getErrorMessage(conversionError, 'PDF 페이지 이미지 변환 중 알 수 없는 오류가 발생했습니다.');
      console.error('pdf image conversion failed', { fileName, error: details });
      return jsonFailure('PDF_IMAGE_CONVERSION_FAILED', 'PDF 페이지 이미지 변환에 실패했습니다.', details, 422, { pageCount });
    }

    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    let response;
    try {
      const client = getOpenAIClient();
      console.info('openai vision request sent', { fileName, model, pageLimit: processedPageCount });
      response = await withTimeout(
        client.responses.create({
          model,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: [
                    '이미지 중심 PDF RFP/제안서 문서를 Vision 기반으로 해석하세요. 단순 OCR이 아니라 문서 이해 결과를 구조화해야 합니다.',
                    `서버에서 PDF의 앞 ${processedPageCount}페이지를 Vision 입력으로 처리한다고 가정하고, ${processedPageCount}페이지까지만 분석하세요.`,
                    '페이지에 보이는 텍스트, 표 구조, 일정표, 평면도, 좌석 배치, 동선, 공간 구역, 시스템/장비 요구사항, 운영 조건, 예산/일정/제약 조건, 참고 이미지, 디자인 방향, RFP 필수 요구사항, 대행 범위, 평가 기준을 추출하세요.',
                    '반드시 JSON만 반환하세요. 형식: {"pages":[{"pageNumber":1,"extractedText":"","visualSummary":"","detectedTables":[],"detectedDiagrams":[],"floorplanOrLayoutInfo":"","keyRequirements":[],"constraints":[],"scheduleInfo":[],"operationInfo":[],"designOrVisualReferences":[],"confidence":0.0,"needsReview":false}]}',
                    '확실하지 않은 내용은 needsReview를 true로 표시하고 confidence를 낮게 부여하세요. 보이지 않는 정보를 추측하지 마세요.',
                  ].join('\n'),
                },
                {
                  type: 'input_file',
                  filename: file.name,
                  file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
                },
              ],
            },
          ],
        }),
        VISION_ROUTE_TIMEOUT_MS,
      );
    } catch (apiError) {
      const details = getErrorMessage(apiError, '알 수 없는 OpenAI Vision API 오류');
      const isTimeoutRisk = /timeout|timed out|deadline|duration|실행 시간 초과/i.test(details);
      console.error('openai vision request failed', { fileName, error: details, isTimeoutRisk });
      return jsonFailure(
        isTimeoutRisk ? 'VERCEL_TIMEOUT_RISK' : 'OPENAI_VISION_API_FAILED',
        isTimeoutRisk ? 'Vercel 실행 시간 초과 가능성이 있습니다.' : 'OpenAI Vision API 호출에 실패했습니다.',
        details,
        isTimeoutRisk ? 504 : 502,
        { pageCount },
      );
    }

    const outputText = response.output_text?.trim() ?? '';
    if (!outputText) {
      console.error('vision analysis failed', { fileName, error: '분석 결과 없음' });
      return jsonFailure('VISION_ANALYSIS_EMPTY', '분석 결과가 없습니다.', 'OpenAI Vision 응답에 output_text가 없습니다.', 422, { pageCount });
    }

    let pages: VisionPageAnalysis[];
    try {
      pages = parseVisionJson(outputText).slice(0, processedPageCount);
      console.info('openai vision response parsed', { fileName, parsedPageCount: pages.length });
    } catch (parseError) {
      const details = getErrorMessage(parseError, 'Vision 분석 응답 파싱 실패');
      console.error('openai vision response parse failed', { fileName, error: details });
      return jsonFailure('OPENAI_RESPONSE_PARSE_FAILED', 'OpenAI 응답 파싱에 실패했습니다.', `${details} / response: ${outputText.slice(0, 500)}`, 422, {
        text: outputText,
        documentAnalysisText: outputText,
        pageCount,
      });
    }

    if (!pages.length) {
      console.error('vision analysis failed', { fileName, error: '분석 결과 없음' });
      return jsonFailure('VISION_ANALYSIS_EMPTY', '분석 결과가 없습니다.', '파싱된 pages 배열이 비어 있습니다.', 422, { pageCount });
    }

    const documentAnalysisText = buildDocumentAnalysisText(pages);
    const validation = validateExtractedText(documentAnalysisText);

    if (!validation.ok) {
      console.warn('vision analysis completed with low text quality', { fileName, processedPageCount, reason: validation.reason });
      const text = validation.text || documentAnalysisText;
      if (validation.reason !== 'short') {
        return jsonFailure('VISION_ANALYSIS_EMPTY', '분석 결과가 충분하지 않습니다.', validation.message, 422, {
          text,
          documentAnalysisText: text,
          pages,
          pageCount,
          processedPageCount,
        });
      }

      return jsonSuccess(
        {
          text,
          documentAnalysisText: text,
          pages,
          status: 'partial',
          message: 'Vision 분석 일부 완료 · 추가 메모 입력 필요',
          pageCount,
          processedPageCount,
          charCount: text.length,
          guidance: VISION_PROCESSING_GUIDANCE,
        },
        200,
      );
    }

    console.info('vision analysis completed', { fileName, processedPageCount, pageCount });
    return jsonSuccess({
      text: validation.text,
      documentAnalysisText: validation.text,
      pages,
      status: 'success',
      message: 'Vision 분석 완료',
      pageCount,
      processedPageCount,
      charCount: validation.text.length,
      guidance: `${VISION_PROCESSING_GUIDANCE} ${VISION_PROCESSING_PAGE_LIMIT_MESSAGE}`,
    });
  } catch (error) {
    const rawMessage = getErrorMessage(error, TEXT_EXTRACTION_FAILED_MESSAGE);
    const isTimeoutRisk = /timeout|timed out|deadline|duration|실행 시간 초과/i.test(rawMessage);
    console.error('vision analysis failed', { fileName, error: rawMessage, isTimeoutRisk });
    return jsonFailure(
      isTimeoutRisk ? 'VERCEL_TIMEOUT_RISK' : 'UNKNOWN_SERVER_ERROR',
      isTimeoutRisk ? 'Vercel 실행 시간 초과 가능성이 있습니다.' : '알 수 없는 서버 오류가 발생했습니다.',
      rawMessage,
      isTimeoutRisk ? 504 : 500,
      { pageCount },
    );
  }
}
