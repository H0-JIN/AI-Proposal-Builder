import { NextResponse } from 'next/server';
import {
  OCR_PROCESSING_GUIDANCE,
  TEXT_EXTRACTION_FAILED_MESSAGE,
  validateExtractedText,
} from '@/lib/extractedTextValidation';
import { getOpenAIClient } from '@/lib/openai';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 10;

type OcrMode = 'first10';

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function getPageCount(buffer: Buffer): number | undefined {
  const pdfLatin1 = buffer.toString('latin1');
  const pageMatches = pdfLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
  return pageMatches?.length;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const mode = (formData.get('mode')?.toString() || 'first10') as OcrMode;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드된 PDF 파일을 찾을 수 없습니다.' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: '파일 크기가 너무 큽니다. 10MB 이하 PDF를 업로드해주세요.' }, { status: 413 });
    }

    if (getExtension(file.name) !== 'pdf') {
      return NextResponse.json({ error: 'OCR은 PDF 파일만 지원합니다.' }, { status: 400 });
    }

    if (mode !== 'first10') {
      return NextResponse.json({ error: '현재 MVP에서는 앞 10페이지 OCR만 지원합니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pageCount = getPageCount(buffer);
    const client = getOpenAIClient();
    const model = process.env.OPENAI_OCR_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const pageLimit = Math.min(pageCount ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                '이 PDF는 텍스트 레이어가 없거나 깨진 이미지 중심 RFP/제안서일 수 있습니다.',
                `앞 ${pageLimit}페이지까지만 OCR 관점으로 읽고, 사람이 볼 수 있는 모든 한국어/영어/숫자 텍스트를 페이지 순서대로 추출하세요.`,
                '추측 요약은 하지 말고 원문 텍스트만 반환하세요.',
                '표/목록은 읽을 수 있는 순서대로 줄바꿈하여 작성하세요.',
                '페이지 구분은 [OCR Page N] 형식으로 표시하세요.',
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

    const extractedText = response.output_text?.trim() ?? '';
    const validation = validateExtractedText(extractedText);

    if (!validation.ok) {
      return NextResponse.json(
        {
          text: validation.text,
          status: validation.reason === 'short' ? 'partial' : 'failed',
          message: validation.reason === 'short' ? 'OCR 일부 추출 · 추가 메모 입력 필요' : 'OCR 추출 실패 · 추가 메모 입력 필요',
          pageCount,
          processedPageCount: pageLimit,
          guidance: OCR_PROCESSING_GUIDANCE,
        },
        { status: validation.reason === 'short' ? 200 : 422 },
      );
    }

    return NextResponse.json({
      text: validation.text,
      status: 'success',
      message: 'OCR 추출 완료',
      pageCount,
      processedPageCount: pageLimit,
      guidance: OCR_PROCESSING_GUIDANCE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : TEXT_EXTRACTION_FAILED_MESSAGE;
    return NextResponse.json({ error: message, status: 'failed', message: 'OCR 추출 실패 · 추가 메모 입력 필요' }, { status: 500 });
  }
}
