-- Align existing Supabase projects/documents/chunks tables with the
-- columns used by the current analysis persistence flow.

alter table if exists public.projects
  add column if not exists client_name text,
  add column if not exists metadata jsonb,
  add column if not exists proposal_type text,
  add column if not exists status text not null default 'active';

alter table if exists public.documents
  add column if not exists mime_type text,
  add column if not exists role text not null default 'other',
  add column if not exists source_type text,
  add column if not exists status text,
  add column if not exists metadata jsonb,
  add column if not exists file_size bigint;

alter table if exists public.chunks
  add column if not exists chunk_text text,
  add column if not exists chunk_index integer,
  add column if not exists section_title text,
  add column if not exists source_type text,
  add column if not exists source_name text,
  add column if not exists token_count integer,
  add column if not exists tags text[] not null default '{}',
  add column if not exists metadata jsonb;
