import type { ChunkRecord, ProposalPatternInput } from './dbTypes';

const maxSourceTextLength = 700;

const narrativeStageByRole: Record<string, string> = {
  cover: 'context',
  table_of_contents: 'intro',
  project_context: 'context',
  core_problem: 'problem',
  audience_insight: 'insight',
  case_insight: 'proof',
  strategic_opportunity: 'strategy',
  concept_rationale: 'strategy',
  content_keyword: 'concept',
  core_concept: 'concept',
  visitor_journey: 'experience',
  spatial_strategy: 'experience',
  hero_experience: 'experience',
  key_media_scene: 'content',
  content_detail: 'content',
  company_credential: 'credential',
  team_credential: 'credential',
  schedule: 'operation',
  operation_plan: 'operation',
  execution_plan: 'proof',
  impact_summary: 'closing',
  closing: 'closing',
};

const patternTypeByRole: Record<string, string> = {
  cover: 'proposal_flow',
  table_of_contents: 'proposal_flow',
  project_context: 'opening_context',
  core_problem: 'core_problem',
  audience_insight: 'audience_insight',
  case_insight: 'audience_insight',
  strategic_opportunity: 'strategic_opportunity',
  concept_rationale: 'concept_rationale',
  core_concept: 'core_concept',
  content_keyword: 'experience_principle',
  visitor_journey: 'visitor_journey',
  spatial_strategy: 'spatial_strategy',
  hero_experience: 'hero_experience',
  key_media_scene: 'media_scene',
  content_detail: 'content_detail',
  company_credential: 'proposal_flow',
  team_credential: 'proposal_flow',
  schedule: 'execution_plan',
  operation_plan: 'execution_plan',
  execution_plan: 'execution_plan',
  impact_summary: 'impact_summary',
  closing: 'closing_summary',
};

const roleLabelByRole: Record<string, string> = {
  cover: 'Cover',
  table_of_contents: 'Table of Contents',
  project_context: 'Project Context',
  core_problem: 'Core Problem',
  audience_insight: 'Audience Insight',
  case_insight: 'Case Insight',
  strategic_opportunity: 'Strategic Opportunity',
  concept_rationale: 'Concept Rationale',
  core_concept: 'Core Concept',
  content_keyword: 'Content Keyword',
  visitor_journey: 'Visitor Journey',
  spatial_strategy: 'Spatial Strategy',
  hero_experience: 'Hero Experience',
  key_media_scene: 'Key Media Scene',
  content_detail: 'Content Detail',
  company_credential: 'Company Credential',
  team_credential: 'Team Credential',
  schedule: 'Schedule',
  operation_plan: 'Operation Plan',
  execution_plan: 'Execution Plan',
  impact_summary: 'Impact Summary',
  closing: 'Closing',
};

const reusablePrincipleByRole: Record<string, string> = {
  cover: 'Open with a clear project identity so the reader immediately understands the proposal frame and client context.',
  table_of_contents: 'Use a contents slide near the opening to preview the evaluator journey before introducing strategy or detail.',
  project_context: 'Establish project context before proposing solutions so every later recommendation feels grounded in the brief.',
  core_problem: 'Name the core problem early so the proposal has a clear reason for the concept and execution plan to exist.',
  audience_insight: 'Introduce audience insight after the problem so the strategy is rooted in the people the experience must move.',
  case_insight: 'Use precedent or case insight as proof before the strategy so the recommendation feels learned rather than assumed.',
  strategic_opportunity: 'Translate context, problem, and audience insight into a strategic opportunity before declaring the concept.',
  concept_rationale: 'Explain why the concept direction is right before naming the concept so the idea feels inevitable.',
  core_concept: 'Declare the core concept only after project context, problem, audience insight, and strategic opportunity have been established.',
  content_keyword: 'Use a content keyword slide to translate the main theme into a concrete creative language that can guide later content proposals.',
  visitor_journey: 'Map the visitor journey after the concept so the reader can see how the idea unfolds over time.',
  spatial_strategy: 'Connect the concept to spatial strategy after the journey so the proposal shows how the experience becomes a place.',
  hero_experience: 'Introduce the representative experience immediately after the concept or journey to make the strategy tangible.',
  key_media_scene: 'Use key media scenes to translate the hero experience into memorable content moments.',
  content_detail: 'Add content details after the major experience beats so the proposal proves the idea can be executed with substance.',
  execution_plan: 'Place execution planning after the concept and experience logic so operational detail supports rather than distracts from the idea.',
  operation_plan: 'Place operation and maintenance after the content proposal to prove feasibility without interrupting the strategic narrative.',
  schedule: 'Introduce schedule after scope and operation logic so timing validates feasibility instead of leading the story.',
  team_credential: 'Place team credentials after the strategy and plan so qualifications answer delivery risk rather than interrupting the proposal thesis.',
  company_credential: 'Use company credentials late in the deck as trust proof after the proposal idea has been established.',
  impact_summary: 'Summarize expected impact near the end so the reader can connect the proposed work to business and audience outcomes.',
  closing: 'Close by reinforcing the thesis and next step so the proposal ends with confidence and momentum.',
};

const whyItMattersByRole: Record<string, string> = {
  cover: 'It frames the document and sets professional credibility before details begin.',
  table_of_contents: 'It makes the document easier to evaluate and signals an intentional proposal flow.',
  project_context: 'It shows the team understands the assignment and constraints.',
  core_problem: 'It creates urgency and gives the evaluator a shared standard for judging the solution.',
  audience_insight: 'It makes the proposal customer-centered rather than supplier-centered.',
  case_insight: 'It adds evidence and reduces perceived risk.',
  strategic_opportunity: 'It bridges diagnosis and solution, making the recommendation feel strategic.',
  concept_rationale: 'It prevents the concept from feeling arbitrary.',
  core_concept: 'It gives the proposal a memorable organizing idea.',
  content_keyword: 'It converts a broad concept into a reusable language for content decisions.',
  visitor_journey: 'It helps evaluators imagine the experience from the visitor point of view.',
  spatial_strategy: 'It demonstrates that the idea can guide layout, movement, and environment decisions.',
  hero_experience: 'It makes the abstract strategy vivid and easy to remember.',
  key_media_scene: 'It clarifies how content moments produce attention, emotion, or participation.',
  content_detail: 'It shows depth, feasibility, and readiness to execute.',
  execution_plan: 'It builds confidence that the team can deliver the proposed idea.',
  operation_plan: 'It proves the concept can be maintained and run after launch.',
  schedule: 'It helps evaluators judge delivery realism.',
  team_credential: 'It reduces perceived execution risk by showing accountable expertise.',
  company_credential: 'It adds trust proof without making the proposal primarily about the vendor.',
  impact_summary: 'It reminds evaluators why the recommendation is valuable.',
  closing: 'It leaves the evaluator with a concise decision-making takeaway.',
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function cleanTitle(value?: string | null) {
  const title = value?.replace(/^#+\s*/, '').replace(/^slide\s*\d+\s*[:.-]?\s*/i, '').trim();
  return title || null;
}

function inferTitleFromText(text: string) {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) return null;
  return cleanTitle(firstLine.length <= 90 ? firstLine : firstLine.slice(0, 90));
}

function inferSlideRole(chunk: ChunkRecord, index: number, total: number) {
  const title = normalize(cleanTitle(chunk.section_title) ?? '');
  const text = normalize(`${chunk.section_title ?? ''}\n${chunk.chunk_text}`);

  if (index === 0 && includesAny(text, [/\bcover\b|표지|제안서|proposal/])) return 'cover';
  if (includesAny(text, [/table of contents|contents|agenda|목차/])) return 'table_of_contents';
  if (index >= total - 1 && includesAny(text, [/closing|thank you|감사|next step|마무리|결론/])) return 'closing';
  if (includesAny(title, [/core concept|big idea|creative concept|핵심 컨셉|콘셉트|컨셉/]) || includesAny(text, [/core concept|big idea|creative concept|핵심 컨셉|콘셉트|컨셉/])) return 'core_concept';
  if (includesAny(text, [/hero experience|signature experience|대표 경험|히어로|시그니처/])) return 'hero_experience';
  if (includesAny(text, [/visitor journey|customer journey|experience journey|동선|여정|journey/])) return 'visitor_journey';
  if (includesAny(text, [/spatial strategy|space strategy|zoning|공간 전략|공간 구성|조닝|레이아웃/])) return 'spatial_strategy';
  if (includesAny(text, [/media scene|key scene|content scene|미디어 씬|미디어 장면|콘텐츠 씬/])) return 'key_media_scene';
  if (includesAny(text, [/operation plan|maintenance|운영 계획|운영|유지보수/])) return 'operation_plan';
  if (includesAny(text, [/timeline|schedule|milestone|일정|스케줄/])) return 'schedule';
  if (includesAny(text, [/team|organization|staff|credentials|담당자|조직|인력/])) return 'team_credential';
  if (includesAny(text, [/company profile|about us|portfolio|credential|회사 소개|실적|수행사/])) return 'company_credential';
  if (includesAny(text, [/content keyword|keyword|creative language|콘텐츠 키워드|키워드/])) return 'content_keyword';
  if (includesAny(text, [/execution plan|production plan|실행 계획|제작 계획/])) return 'execution_plan';
  if (includesAny(text, [/impact|expected effect|kpi|outcome|성과|효과|기대효과|임팩트/])) return 'impact_summary';
  if (includesAny(text, [/strategic opportunity|opportunity|전략적 기회|기회|방향성/])) return 'strategic_opportunity';
  if (includesAny(text, [/concept rationale|why this concept|rationale|컨셉 근거|콘셉트 근거|제안 근거/])) return 'concept_rationale';
  if (includesAny(text, [/audience|target|visitor insight|customer insight|타깃|고객|방문객|인사이트/])) return 'audience_insight';
  if (includesAny(text, [/case study|benchmark|reference|precedent|사례|레퍼런스|벤치마크/])) return 'case_insight';
  if (includesAny(text, [/problem|challenge|pain point|issue|과제|문제|핵심 문제|도전/])) return 'core_problem';
  if (includesAny(text, [/background|context|overview|project|brief|배경|프로젝트|개요|상황/])) return 'project_context';
  if (includesAny(text, [/content|program|detail|콘텐츠|프로그램|세부/])) return 'content_detail';
  if (index === 0) return 'project_context';
  if (index >= total - 1) return 'closing';
  return index < total * 0.25 ? 'project_context' : index < total * 0.45 ? 'strategic_opportunity' : index < total * 0.7 ? 'visitor_journey' : 'content_detail';
}

function summarize(_text: string, title: string | null, role: string) {
  const label = roleLabelByRole[role] ?? 'Proposal Structure';
  return `${label}${title ? ` slide (${title})` : ' slide'} used to advance the proposal from context toward concept, proof, and decision.`;
}

function extractStructuralCues(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
    .filter((line) => line && line.length <= 90)
    .slice(0, 6);
}

function buildSourceEvidence(chunk: ChunkRecord, role: string, title: string | null) {
  const cues = extractStructuralCues(chunk.chunk_text);
  const evidence = [
    `Text-derived structural evidence only; do not reuse as proposal copy.`,
    `Inferred slide role: ${role}.`,
    title ? `Detected slide title/heading: ${title}.` : null,
    cues.length ? `Detected heading cues: ${cues.join(' | ')}.` : null,
  ].filter(Boolean).join(' ');

  return evidence.slice(0, maxSourceTextLength);
}

function relationToConcept(role: string) {
  if (['core_concept', 'concept_rationale', 'strategic_opportunity'].includes(role)) return 'Directly shapes or explains the concept direction.';
  if (['visitor_journey', 'spatial_strategy', 'hero_experience', 'key_media_scene', 'content_detail', 'content_keyword'].includes(role)) return 'Translates the concept into tangible experience, space, or content decisions.';
  if (['execution_plan', 'operation_plan', 'schedule', 'team_credential', 'company_credential', 'impact_summary', 'closing'].includes(role)) return 'Supports confidence that the concept can be delivered and will create value.';
  return 'Builds the evidence and context the concept depends on.';
}

function relationToThesis(role: string) {
  if (role === 'core_concept') return 'States the central proposal thesis as a memorable organizing idea.';
  if (['project_context', 'core_problem', 'audience_insight', 'strategic_opportunity', 'concept_rationale'].includes(role)) return 'Builds the logical argument that makes the proposal thesis feel necessary.';
  if (['visitor_journey', 'spatial_strategy', 'hero_experience', 'key_media_scene', 'content_detail', 'content_keyword'].includes(role)) return 'Demonstrates how the thesis becomes a concrete audience experience.';
  if (['execution_plan', 'operation_plan', 'schedule', 'team_credential', 'company_credential'].includes(role)) return 'Shows the thesis is feasible to produce and operate.';
  return 'Reinforces the thesis as the final takeaway for evaluators.';
}

function inferTags(role: string, stage: string, chunk: ChunkRecord) {
  return Array.from(new Set([role, stage, ...(chunk.categories ?? []), ...(chunk.tags ?? [])].filter(Boolean))).slice(0, 12);
}

export function extractProposalPatternsFromChunks(chunks: ChunkRecord[]): ProposalPatternInput[] {
  const orderedChunks = [...chunks]
    .filter((chunk) => chunk.chunk_text?.trim())
    .sort((a, b) => (a.slide_number ?? Number.MAX_SAFE_INTEGER) - (b.slide_number ?? Number.MAX_SAFE_INTEGER) || a.chunk_index - b.chunk_index);

  const roles = orderedChunks.map((chunk, index) => inferSlideRole(chunk, index, orderedChunks.length));

  return orderedChunks.map((chunk, index) => {
    const role = roles[index];
    const beforeRole = index > 0 ? roles[index - 1] : null;
    const afterRole = index < roles.length - 1 ? roles[index + 1] : null;
    const slideTitle = cleanTitle(chunk.section_title) ?? inferTitleFromText(chunk.chunk_text) ?? roleLabelByRole[role];
    const narrativeStage = narrativeStageByRole[role] ?? 'strategy';

    return {
      project_id: chunk.project_id,
      document_id: chunk.document_id,
      chunk_id: chunk.id,
      pattern_type: patternTypeByRole[role] ?? 'proposal_flow',
      pattern_name: `${roleLabelByRole[role] ?? 'Proposal Pattern'}${slideTitle ? `: ${slideTitle}` : ''}`,
      slide_number: chunk.slide_number ?? null,
      slide_title: slideTitle,
      slide_role: role,
      section_order: index + 1,
      summary: summarize(chunk.chunk_text, slideTitle, role),
      reusable_principle: reusablePrincipleByRole[role] ?? 'Sequence this slide where it best advances the proposal argument from context to decision.',
      why_it_matters: whyItMattersByRole[role] ?? 'It helps the evaluator understand the proposal logic.',
      relation_to_concept: relationToConcept(role),
      relation_to_proposal_thesis: relationToThesis(role),
      before_slide_role: beforeRole,
      after_slide_role: afterRole,
      narrative_stage: narrativeStage,
      source_text: buildSourceEvidence(chunk, role, slideTitle),
      source_type: chunk.source_type ?? 'text_extracted',
      confidence: cleanTitle(chunk.section_title) || chunk.slide_number ? 'high' : 'medium',
      tags: inferTags(role, narrativeStage, chunk),
      metadata: {
        chunkIndex: chunk.chunk_index,
        originalChunkMetadata: chunk.metadata ?? null,
        extractionMethod: 'heuristic_text_structure_v1',
      },
    };
  });
}
