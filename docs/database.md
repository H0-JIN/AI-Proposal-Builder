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

Database storage is currently optional and non-blocking. After analysis completes, the app attempts to save a `projects` record, one `documents` record per uploaded file, and analyzed `chunks` with `embedding` set to `null`. The in-memory analysis, concept generation, proposal generation, retrieval from current uploads, slide generation, and PPTX export flows still work without Supabase and do not depend on the database save. The app does **not** yet perform vector retrieval, generate embeddings, retrieve old proposal patterns, alter proposal prompts, or change PPTX export behavior.
