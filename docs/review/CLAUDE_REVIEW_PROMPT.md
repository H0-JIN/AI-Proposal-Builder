# Prompt to Paste into Claude

You are a senior AI product architect and proposal strategy consultant. Please review the AI Proposal Builder project and provide direct, practical critique.

Context:
- This product helps proposal planners convert RFPs, reference documents, past proposals, and notes into an RFP analysis, strategic concept directions, final concept name options, and a proposal outline.
- The current stack is Next.js, TypeScript, OpenAI API, Supabase Postgres/pgvector, and Tailwind.
- The team is concerned that strategic directions sometimes behave like fixed templates, that prior proposal patterns may over-influence new RFPs, and that RFP type classification may be acting like a direction template instead of a guardrail.

Please critique the project across these areas:

1. Product direction
   - Is this the right MVP for an AI proposal builder?
   - What is most valuable for proposal planners?
   - What should not be built yet?

2. Prompt architecture
   - Should strategy generation be prompt-led, rule-led, or hybrid?
   - How should prompts force discovery of the current RFP's winning condition?
   - Where should validation and debug output live?

3. RFP-specific strategy generation
   - How should the system avoid applying WDS-like multi-entity logic to single-brand visitor-room RFPs?
   - How should it avoid applying WDS-style grouping logic to hydrogen/energy exhibitions?
   - How should it distinguish proposal type, scope, evaluator priorities, client anxiety, audience behavior, proof burden, and constraints?

4. `proposal_patterns` usage
   - How should prior proposal patterns be retrieved, filtered, weighted, and constrained?
   - When should patterns influence structure only, and when may they influence strategy?
   - How can the product prevent pattern contamination of current RFP outputs?

5. Won/lost outcome learning
   - How should won/lost outcomes influence generation?
   - Should outcome data be used as positive examples, negative examples, risk flags, scoring signals, or retrieval filters?
   - How should external loss reasons be separated from quality-related loss reasons?

6. Correct hierarchy
   - What should be the hierarchy between current RFP evidence, proposal patterns, concept strategy, final naming, and outline generation?
   - What should be hard constraints versus soft inspiration?

7. UX flow
   - What is the best workflow for a proposal planner?
   - Should strategic direction cards, final naming options, validation/debug information, and outline generation be separated?
   - How should long text be displayed so users can evaluate quality without truncation?

8. Database and RAG direction
   - Is the current Supabase/pgvector and proposal pattern direction appropriate?
   - What schema or retrieval simplifications would improve reliability?
   - What data should be stored now versus later?

9. Risks and over-engineering
   - What parts of the architecture seem overbuilt for the current MVP?
   - What parts are risky because they create false confidence?

10. Next implementation priorities
   - What should be fixed first?
   - What should be deferred?
   - Please propose a practical phased implementation plan.

Please be specific. If you recommend prompt changes, describe the intended prompt behavior in plain English. If you recommend architecture changes, explain what files or modules are likely involved. Do not assume access to secrets or environment variables.
