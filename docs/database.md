# Database foundation: Supabase + pgvector

This project includes an optional Supabase database foundation for internal proposal/RFP analysis persistence. The upload, analyze, concept, outline, slide generation, and PPTX export flows still run without Supabase because database storage is non-blocking.

## Required environment variables

Add these server/runtime variables when you want to enable persistent storage:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

- `NEXT_PUBLIC_SUPABASE_URL` is the Supabase project URL and is used by both browser Storage uploads and server-side database helpers.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is used by the browser to upload DB library files directly to Supabase Storage. Configure Storage policies so this key can insert into the `proposal-library` bucket path used below.
- `SUPABASE_SERVICE_ROLE_KEY` is used only by server-side helpers to download private Storage objects and persist database rows. It must never be exposed to browser/client code.
- If the server-side Supabase values are missing, database helper functions return safe empty results instead of throwing. Large DB uploads that require Storage also need the public Supabase URL/anon key in the browser.


## Supabase Storage bucket for DB library uploads

Large existing proposal/reference/memo uploads avoid Vercel/serverless request payload limits by sending the original file directly from the browser to Supabase Storage first. Create this bucket before using large DB library upload:

| Setting | Value |
| --- | --- |
| Bucket name | `proposal-library` |
| Access | Private is supported and recommended |
| Upload path | `project-documents/{timestamp}-{safeFileName}` |
| Expected extensions | `pdf`, `pptx`, `docx`, `md`, `txt` |

The browser uploads with `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then `/api/extract-from-storage` downloads the private object with `SUPABASE_SERVICE_ROLE_KEY`, extracts text, saves `documents`/`chunks`, and leaves chunk embeddings as `null`.

Example Storage policy direction for authenticated or otherwise trusted clients: allow `insert` into `storage.objects` where `bucket_id = 'proposal-library'` and `name` starts with `project-documents/`. Keep read access private; server-side extraction uses the service role key.

## Applying the schema

The canonical fresh-install schema lives in [`supabase/schema.sql`](../supabase/schema.sql). It enables `pgvector` and `pgcrypto`, then creates these tables:

- `projects`
- `documents`
- `chunks`
- `slide_visual_patterns`

To apply it in the Supabase dashboard:

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Paste the contents of `supabase/schema.sql`.
4. Run the SQL.

For an existing Supabase database, apply [`supabase/migrations/align_persistence_schema.sql`](../supabase/migrations/align_persistence_schema.sql) for the base persistence columns, then [`supabase/migrations/add_slide_visual_patterns.sql`](../supabase/migrations/add_slide_visual_patterns.sql) for slide-level visual pattern storage. The migrations use idempotent DDL (`add column if not exists` or `create table if not exists`) so they are safe to run against databases that already received the columns or table manually.

## Final schema

### `projects`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `name` | `text` | Required |
| `client_name` | `text` | Nullable |
| `proposal_type` | `text` | Nullable |
| `status` | `text` | Required, defaults to `'active'` |
| `metadata` | `jsonb` | Nullable |
| `created_at` | `timestamptz` | Required, defaults to `now()` |
| `updated_at` | `timestamptz` | Required, defaults to `now()` |

Current persistence inserts `name`, `client_name`, `proposal_type`, `status`, and `metadata` into this table.

### `documents`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `project_id` | `uuid` | Required, references `projects(id)` with cascade delete |
| `file_name` | `text` | Required |
| `role` | `text` | Required, defaults to `'other'` |
| `mime_type` | `text` | Nullable |
| `source_type` | `text` | Nullable |
| `metadata` | `jsonb` | Nullable |
| `status` | `text` | Nullable, reserved for document processing status |
| `file_size` | `bigint` | Nullable, reserved for uploaded file size in bytes |
| `created_at` | `timestamptz` | Required, defaults to `now()` |

Current persistence inserts `project_id`, `file_name`, `role`, `mime_type`, `source_type`, and `metadata` into this table. `status` and `file_size` are included to match the live schema columns that were added manually during persistence debugging.

### `chunks`

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `project_id` | `uuid` | Required, references `projects(id)` with cascade delete |
| `document_id` | `uuid` | Required, references `documents(id)` with cascade delete |
| `chunk_index` | `integer` | Required by the current persistence code |
| `chunk_text` | `text` | Required by the current persistence code |
| `category` | `text` | Nullable |
| `categories` | `text[]` | Required, defaults to an empty array |
| `tags` | `text[]` | Required, defaults to an empty array |
| `importance` | `text` | Required, defaults to `'medium'`; constrained to `'high'`, `'medium'`, or `'low'` |
| `page_number` | `integer` | Nullable |
| `slide_number` | `integer` | Nullable |
| `section_title` | `text` | Nullable |
| `source_type` | `text` | Nullable, reserved for chunk provenance |
| `source_name` | `text` | Nullable, reserved for source display names |
| `token_count` | `integer` | Nullable, reserved for token accounting |
| `embedding` | `vector(1536)` | Nullable; currently saved as `null` |
| `metadata` | `jsonb` | Nullable |
| `created_at` | `timestamptz` | Required, defaults to `now()` |

Current persistence inserts `project_id`, `document_id`, `chunk_index`, `chunk_text`, `category`, `categories`, `tags`, `importance`, `page_number`, `slide_number`, `section_title`, `embedding`, and `metadata` into this table. `source_type`, `source_name`, and `token_count` are included to match the live schema columns that were added manually during persistence debugging.

### `slide_visual_patterns`

`slide_visual_patterns` stores slide-level visual and layout guidance extracted or inferred from uploaded documents for future proposal generation. It is a separate layer from text chunks so future generation can retrieve patterns like slide role, layout style, visual density, diagram approach, tone, and image direction without overloading `chunks.chunk_text`.

| Column | Type | Default / notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `project_id` | `uuid` | Nullable, references `projects(id)` with cascade delete |
| `document_id` | `uuid` | Nullable, references `documents(id)` with cascade delete |
| `chunk_id` | `uuid` | Nullable, references `chunks(id)` and is set to `null` when the source chunk is deleted |
| `slide_number` | `integer` | Nullable source slide number |
| `slide_title` | `text` | Nullable slide title or heading |
| `slide_role` | `text` | Nullable functional role, such as cover, divider, proof point, timeline, case study, or recommendation |
| `layout_type` | `text` | Nullable layout classification, such as title-and-body, two-column, hero-image, dashboard, or diagram |
| `visual_text_ratio` | `text` | Nullable qualitative balance between visual content and text |
| `hero_element` | `text` | Nullable primary focal element, such as a chart, image, quote, KPI, map, or diagram |
| `visual_direction` | `text` | Nullable visual/layout guidance for a future generated slide |
| `diagram_type` | `text` | Nullable diagram pattern, such as process, timeline, matrix, ecosystem, or funnel |
| `tone_and_manner` | `text` | Nullable description of the visual tone or design manner |
| `image_prompt` | `text` | Nullable image-generation-ready prompt or seed direction for future use |
| `source_type` | `text` | Defaults to `'text_extracted'`; records how the pattern was derived |
| `confidence` | `text` | Defaults to `'medium'`; qualitative confidence of the pattern |
| `metadata` | `jsonb` | Defaults to an empty object for extractor-specific context |
| `created_at` | `timestamptz` | Defaults to `now()` |

Vision-based extraction from PDFs/PPTX files is not implemented yet. This table is schema/storage foundation only: the current app does not write Vision-derived records, retrieve visual patterns during generation, alter proposal prompts, or change PPTX export behavior based on this table.

## Current status

Database storage is currently optional and non-blocking. After analysis completes, the app attempts to save one `projects` record, one `documents` record per uploaded file, and analyzed `chunks` with `embedding` explicitly set to `null`. The `slide_visual_patterns` table is available for future visual/layout guidance storage but is not wired into extraction or generation yet.

Embeddings are not generated yet, so the `chunks.embedding` column remains `null` for saved RFP analysis chunks. Vision-based slide pattern extraction is also not generated yet, so visual pattern records are not created by the current PDF/PPTX processing flow. Vector retrieval against Supabase is also not implemented yet. The app does not yet retrieve old proposal patterns from Supabase, alter proposal prompts using persisted vectors, or change PPTX export behavior based on database records.
