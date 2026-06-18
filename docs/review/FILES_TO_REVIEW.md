# Files to Review

## Core generation routes
- `app/api/analyze/route.ts` — RFP/source document analysis.
- `app/api/concepts/route.ts` — strategic concept generation.
- `app/api/concept-names/route.ts` — separate final concept naming generation.
- `app/api/outline/route.ts` — proposal outline generation.
- `app/api/narrative/route.ts` — proposal narrative generation.

## Main UI
- `app/page.tsx` — main upload, analysis, concept, naming, and outline UI.
- `app/layout.tsx` — application shell/metadata.
- `app/globals.css` — global styling that may affect truncation and card display.

## Schemas and shared types
- `lib/schemas.ts` — JSON schemas for analysis, concepts, naming, narrative, and outline outputs.
- `lib/types.ts` — TypeScript domain types for documents, analysis, concepts, outcomes, and proposal data.
- `lib/dbTypes.ts` — database-facing type definitions.

## Concept strategy and naming guards
- `lib/conceptNamingGuard.ts` — concept naming validation/selection helpers.
- `lib/conceptContextSanitizer.ts` — context cleanup before concept generation.
- `lib/conceptPromptVersion.ts` — prompt/version metadata for concept generation.
- `lib/strategyLayer.ts` — strategy layer construction from selected concepts.
- `lib/rfpDifferentiation.ts` — RFP differentiation logic.
- `lib/rfpRequirements.ts` — RFP requirement extraction/coverage helpers.
- `lib/referenceGuard.ts` — guardrails for reference document use.
- `lib/kpiGuard.ts` — KPI-related guardrails.
- `lib/proposalStructureGuard.ts` — proposal structure guardrails.

## RAG, persistence, and proposal patterns
- `lib/rag.ts` — local chunking/retrieval types and utilities.
- `lib/ragStorage.ts` — Supabase persistence and retrieval for chunks, proposal patterns, and visual patterns.
- `lib/proposalPatternExtractor.ts` — extraction of reusable patterns from past proposals.
- `lib/proposalPatternBackfill.ts` — backfill support for proposal patterns.
- `lib/proposalPatternOutline.ts` — proposal-pattern-derived outline guidance.
- `lib/outcomeReasonClassifier.ts` — won/lost outcome reason and usability classification.
- `app/api/backfill-proposal-patterns/route.ts` — API route for proposal pattern backfill.
- `app/api/persist-document/route.ts` — document persistence route.
- `app/api/persist-analysis/route.ts` — analysis persistence route.

## Document extraction and validation
- `lib/documentTextExtraction.ts` — text extraction utilities.
- `lib/extractedTextValidation.ts` — extracted text quality validation.
- `lib/documentRoles.ts` — role classification for uploaded documents.
- `lib/documentPersistence.ts` — document persistence helpers.
- `lib/analysisPersistence.ts` — analysis persistence helpers.
- `app/api/extract-text/route.ts` — text extraction route.
- `app/api/ocr-pdf/route.ts` — OCR extraction route.
- `app/api/vision-pdf/route.ts` — Vision PDF analysis route.
- `app/api/extract-from-storage/route.ts` — extraction from stored files.

## Database
- `supabase/schema.sql` — current Supabase schema.
- `supabase/migrations/add_proposal_patterns.sql` — proposal pattern migration.
- `supabase/migrations/add_proposal_pattern_failure_areas.sql` — outcome/failure-area migration.
- `supabase/migrations/add_slide_visual_patterns.sql` — slide visual pattern migration.
- `supabase/migrations/align_persistence_schema.sql` — persistence schema alignment.
- `supabase/migrations/normalize_document_roles_and_project_reuse.sql` — document role/project reuse migration.
