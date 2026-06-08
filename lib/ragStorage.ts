import 'server-only';

import { getSupabaseConfigState } from './supabase';
import type { ChunkImportance, ChunkRecord, DocumentRecord, DocumentRole, JsonValue, ProjectRecord } from './dbTypes';

export interface CreateProjectInput {
  name: string;
  clientName?: string | null;
  proposalType?: string | null;
  status?: string;
  metadata?: JsonValue | null;
}

export interface CreateDocumentInput {
  projectId: string;
  fileName: string;
  role: DocumentRole;
  mimeType?: string | null;
  sourceType?: string | null;
  metadata?: JsonValue | null;
}

export interface SaveChunkInput {
  chunkIndex: number;
  chunkText: string;
  category?: string | null;
  categories?: string[];
  tags?: string[];
  importance?: ChunkImportance;
  pageNumber?: number | null;
  slideNumber?: number | null;
  sectionTitle?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  tokenCount?: number | null;
  embedding?: number[] | null;
  metadata?: JsonValue | null;
}

export interface SaveChunksInput {
  projectId: string;
  documentId: string;
  chunks: SaveChunkInput[];
}

function logRagStorageError(operation: string, error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
  console.error(`[ragStorage] ${operation} failed: ${message}`);
}

export function isSupabaseConfigured() {
  return getSupabaseConfigState().configured;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRecord | null> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from('projects')
      .insert({
        name: input.name,
        client_name: input.clientName ?? null,
        proposal_type: input.proposalType ?? null,
        status: input.status ?? 'active',
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single();

    if (error) {
      logRagStorageError('createProject', error);
      return null;
    }

    return data;
  } catch (error) {
    logRagStorageError('createProject', error);
    return null;
  }
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentRecord | null> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from('documents')
      .insert({
        project_id: input.projectId,
        file_name: input.fileName,
        role: input.role,
        mime_type: input.mimeType ?? null,
        source_type: input.sourceType ?? null,
        metadata: input.metadata ?? null,
      })
      .select('*')
      .single();

    if (error) {
      logRagStorageError('createDocument', error);
      return null;
    }

    return data;
  } catch (error) {
    logRagStorageError('createDocument', error);
    return null;
  }
}

export async function saveChunks(input: SaveChunksInput): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || input.chunks.length === 0) {
    return [];
  }

  try {
    const rows = input.chunks.map((chunk) => ({
      project_id: input.projectId,
      document_id: input.documentId,
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.chunkText,
      category: chunk.category ?? chunk.categories?.[0] ?? null,
      categories: chunk.categories ?? [],
      tags: chunk.tags ?? [],
      importance: chunk.importance ?? 'medium',
      page_number: chunk.pageNumber ?? null,
      slide_number: chunk.slideNumber ?? null,
      section_title: chunk.sectionTitle ?? null,
      source_type: chunk.sourceType ?? null,
      source_name: chunk.sourceName ?? null,
      token_count: chunk.tokenCount ?? null,
      embedding: chunk.embedding ?? null,
      metadata: chunk.metadata ?? null,
    }));

    const { data, error } = await client.from('chunks').insert(rows).select('*');

    if (error) {
      logRagStorageError('saveChunks', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('saveChunks', error);
    return [];
  }
}

export async function getProjectChunks(projectId: string): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('chunks')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .order('chunk_index', { ascending: true });

    if (error) {
      logRagStorageError('getProjectChunks', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('getProjectChunks', error);
    return [];
  }
}

export async function searchChunksByCategory(projectId: string, categories: string[]): Promise<ChunkRecord[]> {
  const { client } = getSupabaseConfigState();

  if (!client || categories.length === 0) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('chunks')
      .select('*')
      .eq('project_id', projectId)
      .or(`category.in.(${categories.map(escapeSupabaseListValue).join(',')}),categories.ov.{${categories.map(escapePostgresArrayValue).join(',')}}`)
      .order('created_at', { ascending: true })
      .order('chunk_index', { ascending: true });

    if (error) {
      logRagStorageError('searchChunksByCategory', error);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logRagStorageError('searchChunksByCategory', error);
    return [];
  }
}

function escapeSupabaseListValue(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapePostgresArrayValue(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
