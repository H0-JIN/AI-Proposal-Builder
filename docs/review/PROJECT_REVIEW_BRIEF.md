# AI Proposal Builder — Project Review Brief

## Project purpose
AI Proposal Builder helps proposal teams turn an RFP, reference documents, prior proposals, and working notes into a proposal strategy package: RFP analysis, strategic concept directions, final concept name options, and a proposal outline.

## Target user
The primary user is a proposal planner or strategy lead preparing competitive exhibition, event, brand experience, visitor-room, conference/forum, or public-tender proposals under time pressure.

## Current MVP flow
1. Upload or paste RFP/source materials.
2. Extract text with PDF/text extraction, OCR, or Vision fallback depending on document quality.
3. Analyze the RFP into requirements, scope, constraints, target, KPI, schedule, and inferred proposal type.
4. Generate strategic concept candidates.
5. Generate separate final concept name options.
6. Generate a proposal outline from the selected concept and analysis.
7. Optionally persist projects, documents, chunks, and proposal patterns to Supabase for later reuse.

## Current technical stack
- Next.js App Router with React 19.
- TypeScript.
- OpenAI API for analysis, concept generation, naming, narrative, outline, and vision-based extraction.
- Supabase Postgres with pgvector for optional persistent storage and RAG-style retrieval.
- Tailwind CSS for UI.
- pptxgenjs/jszip for presentation-related processing.

## Current database structure summary
The Supabase schema currently defines:
- `projects`: project metadata and proposal type.
- `documents`: uploaded/source documents with roles such as RFP, proposal, reference, and memo.
- `chunks`: extracted document chunks with categories, tags, importance, page/slide metadata, embeddings, and source metadata.
- `proposal_patterns`: reusable slide/strategy/content patterns extracted from past proposals, with outcome metadata and usability flags.
- `slide_visual_patterns`: reusable visual/layout patterns extracted from proposal slides.

## Current RFP analysis flow
The analysis route extracts structured information from the current RFP and supporting documents. The structured schema includes project overview, client challenge, task sections, inferred proposal type, scope types, deliverables, scope of work, evaluation criteria, constraints, schedule, target/spatial/content/operation conditions, missing info, and confirmation needs.

## Current concept generation flow
The concepts route uses the RFP analysis, source documents, optional retrieved chunks, proposal narrative/context, and proposal patterns to generate multiple concept candidates. Each concept includes strategic direction metadata, concept rationale, naming fields, validation fields, mechanism/metaphor fields, evaluation scores, and recommendation data.

## Current final concept naming flow
The concept naming route can generate 8–12 separate final naming options for a selected strategy/concept. The naming schema includes name, language mode, Korean subtitle, one-line slogan, fit-to-RFP rationale, scores, risks, and naming style. The intended UX is for final naming options to appear as a separate bottom section rather than being mixed into strategic direction cards.

## Current proposal outline generation flow
The outline route generates a slide/section outline from the RFP analysis, selected concept, proposal narrative, requirements coverage, and optional proposal pattern structure guidance. The outline still needs qualitative review because structure can inherit inappropriate pattern logic.

## Current use of proposal_patterns
`proposal_patterns` stores reusable principles, slide roles, narrative stages, relation to concept/thesis, source text, confidence, tags, and usability flags. These patterns are intended to inform structure and strategy, but there is a risk that patterns from prior proposals over-steer the current RFP, especially when the current RFP differs in brand, entity count, industry, or winning condition.

## Current use of won/lost proposal outcome data
Past proposal outcome metadata can be attached to library documents and patterns. Outcome reason classification can mark reasons as external, quality, mixed, or unknown and can set failure areas and usability flags. This is useful for learning, but the product still needs clearer rules for when won/lost evidence should influence concept strategy versus only warn against known failure modes.

## Known issues
- Strategic directions can still behave like fixed templates instead of being discovered from the current RFP.
- Pocari/single-brand visitor-room RFPs sometimes receive WDS-like multi-entity logic.
- Hydrogen/energy exhibition RFPs can incorrectly receive WDS-style grouping logic.
- `proposal_patterns` may over-influence current strategy generation.
- RFP type is being treated too much like a direction template instead of a guardrail.
- Final concept name options need to be visually and logically separated from strategic direction cards.
- Debug/validation text should be hidden from normal user-facing cards.
- Text truncation/ellipsis still makes evaluation difficult.
- Outline generation needs later review.

## Recent changes attempted
- Added richer schemas for concept strategy, direction source/debug, concept validation, and final name options.
- Added naming guard logic to reduce weak or scope-inappropriate concept names.
- Added proposal pattern extraction/storage and outcome metadata/usability flags.
- Added RFP differentiation and requirement guard utilities.
- Added persistence routes for documents and analyses.
- Added concept-name generation as a separate API route.

## What still fails
The system still sometimes generalizes from past proposal structures or RFP type labels instead of identifying the unique winning condition in the current RFP. It can introduce multi-entity grouping where the RFP is actually single-brand or product-specific. It can also show internal validation/debug fields in the user-facing experience, and long text is sometimes truncated before the user can evaluate quality.

## Key questions for external review
- What is the right product scope for an MVP proposal planner?
- Should strategic direction generation be mostly prompt-led, rule-led, or hybrid?
- How should RFP type classification act as a guardrail without becoming a template?
- How should proposal patterns be retrieved, weighted, filtered, and constrained?
- How should won/lost data influence current generation without causing contamination?
- What hierarchy should govern RFP evidence, patterns, concept strategy, final naming, and outline generation?
- What should be simplified before adding more features?
