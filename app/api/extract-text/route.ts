import { NextResponse } from 'next/server';
import {
  MAX_DB_FILE_SIZE_BYTES,
  MAX_RFP_FILE_SIZE_BYTES,
  extractDocumentTextFromBuffer,
} from '@/lib/documentTextExtraction';
import { TEXT_EXTRACTION_FAILED_MESSAGE } from '@/lib/extractedTextValidation';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const mode = formData.get('mode') === 'db' ? 'db' : 'rfp';
    const maxFileSizeBytes = mode === 'db' ? MAX_DB_FILE_SIZE_BYTES : MAX_RFP_FILE_SIZE_BYTES;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드된 파일을 찾을 수 없습니다.' }, { status: 400 });
    }

    if (file.size > maxFileSizeBytes) {
      const maxMb = Math.floor(maxFileSizeBytes / 1024 / 1024);
      return NextResponse.json({ error: `파일 크기가 너무 큽니다. ${maxMb}MB 이하 파일을 업로드해주세요.` }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const { result, httpStatus } = await extractDocumentTextFromBuffer({
      buffer: Buffer.from(arrayBuffer),
      fileName: file.name,
      fileSize: file.size,
      mode,
    });

    return NextResponse.json(result, { status: httpStatus });
  } catch {
    return NextResponse.json({ error: TEXT_EXTRACTION_FAILED_MESSAGE }, { status: 500 });
  }
}
