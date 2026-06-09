import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, DocumentRole } from './dbTypes';

export const PROPOSAL_LIBRARY_BUCKET = 'proposal-library';
export const PROPOSAL_LIBRARY_PATH_PREFIX = 'project-documents';

export type DbLibraryDocumentRole = Extract<DocumentRole, 'rfp' | 'proposal' | 'reference' | 'memo'>;

export interface UploadDbLibraryFileInput {
  file: File;
  role: DbLibraryDocumentRole;
}

export interface UploadedDbLibraryStorageFile {
  bucket: typeof PROPOSAL_LIBRARY_BUCKET;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  role: DbLibraryDocumentRole;
}

let browserClient: SupabaseClient<Database> | null | undefined;

function getSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return null;
  }

  if (browserClient === undefined) {
    browserClient = createClient<Database>(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return browserClient;
}

export function isSupabaseStorageUploadConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getSafeStorageFileName(fileName: string) {
  const fallbackName = 'uploaded-document';
  const trimmedName = fileName.trim() || fallbackName;
  const extension = trimmedName.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
  const baseName = extension ? trimmedName.slice(0, -extension.length) : trimmedName;
  const safeBaseName = baseName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9가-힣._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 120) || fallbackName;

  return `${safeBaseName}${extension}`;
}

export function buildDbLibraryStoragePath(fileName: string, timestamp = Date.now()) {
  return `${PROPOSAL_LIBRARY_PATH_PREFIX}/${timestamp}-${getSafeStorageFileName(fileName)}`;
}

export async function uploadDbLibraryFileToStorage({ file, role }: UploadDbLibraryFileInput): Promise<UploadedDbLibraryStorageFile> {
  const client = getSupabaseBrowserClient();

  if (!client) {
    throw new Error('Supabase Storage 업로드 환경 변수가 설정되지 않았습니다. NEXT_PUBLIC_SUPABASE_URL 및 NEXT_PUBLIC_SUPABASE_ANON_KEY를 확인해 주세요.');
  }

  const storagePath = buildDbLibraryStoragePath(file.name);
  const { error } = await client.storage.from(PROPOSAL_LIBRARY_BUCKET).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase Storage 업로드 실패: ${error.message}`);
  }

  return {
    bucket: PROPOSAL_LIBRARY_BUCKET,
    storagePath,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    fileSize: file.size,
    role,
  };
}
