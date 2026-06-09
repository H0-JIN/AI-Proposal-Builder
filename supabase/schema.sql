-- Supabase + pgvector foundation for optional persistent RAG storage.
-- Run this in the Supabase SQL editor or with `supabase db push`.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  proposal_type text,
  status text not null default 'active',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_name text not null,
  role text not null default 'memo',
  document_role text,
  mime_type text,
  source_type text,
  metadata jsonb,
  status text,
  file_size bigint,
  created_at timestamptz not null default now(),
  constraint documents_role_check check (role in ('rfp', 'proposal', 'reference', 'memo')),
  constraint documents_document_role_check check (document_role is null or document_role in ('rfp', 'proposal', 'reference', 'memo'))
);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  chunk_text text not null,
  category text,
  categories text[] not null default '{}',
  tags text[] not null default '{}',
  importance text not null default 'medium',
  page_number integer,
  slide_number integer,
  section_title text,
  source_type text,
  source_name text,
  token_count integer,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint chunks_importance_check check (importance in ('high', 'medium', 'low'))
);


create table if not exists public.proposal_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_id uuid references public.chunks(id) on delete set null,
  pattern_type text,
  pattern_name text,
  slide_number int,
  slide_title text,
  slide_role text,
  section_order int,
  summary text,
  reusable_principle text,
  why_it_matters text,
  relation_to_concept text,
  relation_to_proposal_thesis text,
  before_slide_role text,
  after_slide_role text,
  narrative_stage text,
  outcome text,
  outcome_reason text,
  outcome_reason_type text,
  source_text text,
  source_type text default 'text_extracted',
  confidence text default 'medium',
  tags text[],
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.slide_visual_patterns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_id uuid references public.chunks(id) on delete set null,
  slide_number int,
  slide_title text,
  slide_role text,
  layout_type text,
  visual_text_ratio text,
  hero_element text,
  visual_direction text,
  diagram_type text,
  tone_and_manner text,
  image_prompt text,
  source_type text default 'text_extracted',
  confidence text default 'medium',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists projects_created_at_idx on public.projects(created_at desc);
create index if not exists documents_project_id_idx on public.documents(project_id);
create index if not exists chunks_project_id_idx on public.chunks(project_id);
create index if not exists chunks_document_id_idx on public.chunks(document_id);
create index if not exists chunks_category_idx on public.chunks(category);
create index if not exists chunks_categories_gin_idx on public.chunks using gin(categories);
create index if not exists chunks_embedding_idx on public.chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists proposal_patterns_project_id_idx on public.proposal_patterns(project_id);
create index if not exists proposal_patterns_document_id_idx on public.proposal_patterns(document_id);
create index if not exists proposal_patterns_chunk_id_idx on public.proposal_patterns(chunk_id);
create index if not exists proposal_patterns_slide_role_idx on public.proposal_patterns(slide_role);
create index if not exists proposal_patterns_narrative_stage_idx on public.proposal_patterns(narrative_stage);
create index if not exists proposal_patterns_outcome_reason_type_idx on public.proposal_patterns(outcome_reason_type);
create index if not exists proposal_patterns_tags_gin_idx on public.proposal_patterns using gin(tags);
create index if not exists slide_visual_patterns_project_id_idx on public.slide_visual_patterns(project_id);
create index if not exists slide_visual_patterns_document_id_idx on public.slide_visual_patterns(document_id);
create index if not exists slide_visual_patterns_chunk_id_idx on public.slide_visual_patterns(chunk_id);
