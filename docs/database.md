# Database foundation: Supabase + pgvector

This project includes an optional Supabase database foundation for future internal proposal RAG storage. The current upload, analyze, outline, slide generation, and PPTX export flows still run in memory and do not require Supabase.

## Required environment variables

Add these server/runtime variables when you want to enable persistent RAG storage:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

- `NEXT_PUBLIC_SUPABASE_URL` is the Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` is used only by server-side helpers and must never be exposed to browser/client code.
- If either value is missing, the Supabase client is disabled and database helper functions return safe empty results instead of throwing.

## Applying the schema

The schema lives in [`supabase/schema.sql`](../supabase/schema.sql). It enables `pgvector` and creates the RAG foundation tables:

- `projects`
- `documents`
- `chunks`

To apply it in the Supabase dashboard:

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Paste the contents of `supabase/schema.sql`.
4. Run the SQL.

If you use the Supabase CLI, you can also run the SQL against your linked project with your normal migration workflow.

## Current status

Database storage is currently optional and foundation-only. The app does **not** yet automatically save uploads to Supabase, replace in-memory chunks with database chunks, perform vector retrieval, retrieve old proposal patterns, alter proposal prompts, or change PPTX export behavior.
