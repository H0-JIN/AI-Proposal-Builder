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

type VisionMode = 'first10';

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
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const mode = (formData.get('mode')?.toString() || 'first10') as VisionMode;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드된 PDF 파일을 찾을 수 없습니다.' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: '파일 크기가 너무 큽니다. 10MB 이하 PDF를 업로드해주세요.' }, { status: 413 });
    }

    if (getExtension(file.name) !== 'pdf') {
      return NextResponse.json({ error: 'Vision 분석은 PDF 파일만 지원합니다.' }, { status: 400 });
    }

    if (mode !== 'first10') {
      return NextResponse.json({ error: '현재 MVP에서는 앞 10페이지 Vision 분석만 지원합니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pageCount = getPageCount(buffer);
    const processedPageCount = Math.min(pageCount ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
    const client = getOpenAIClient();
    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const response = await client.responses.create({
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
    });

    const outputText = response.output_text?.trim() ?? '';
    const pages = parseVisionJson(outputText).slice(0, processedPageCount);
    const documentAnalysisText = buildDocumentAnalysisText(pages);
    const validation = validateExtractedText(documentAnalysisText);

    if (!validation.ok) {
      return NextResponse.json(
        {
          text: validation.text,
          documentAnalysisText,
          pages,
          status: validation.reason === 'short' ? 'partial' : 'failed',
          message: validation.reason === 'short' ? 'Vision 분석 일부 완료 · 추가 메모 입력 필요' : 'Vision 분석 실패 · 추가 메모 입력 필요',
          pageCount,
          processedPageCount,
          guidance: VISION_PROCESSING_GUIDANCE,
        },
        { status: validation.reason === 'short' ? 200 : 422 },
      );
    }

    return NextResponse.json({
      text: validation.text,
      documentAnalysisText: validation.text,
      pages,
      status: 'success',
      message: 'Vision 분석 완료',
      pageCount,
      processedPageCount,
      guidance: `${VISION_PROCESSING_GUIDANCE} ${VISION_PROCESSING_PAGE_LIMIT_MESSAGE}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : TEXT_EXTRACTION_FAILED_MESSAGE;
    return NextResponse.json({ error: message, status: 'failed', message: 'Vision 분석 실패 · 추가 메모 입력 필요' }, { status: 500 });
  }
}
