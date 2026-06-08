import type { AnalysisResult, ConceptCandidate, ProjectInput, ProposalNarrative, ProposalScopeType, SlideContent, SlideOutline } from '@/lib/types';

export const proposalScopeTypeLabels: Record<ProposalScopeType, string> = {
  contentDevelopment: '콘텐츠 개발',
  boothExhibition: '부스/전시',
  experienceMarketing: '체험 마케팅',
  brandActivation: '브랜드 액티베이션',
  operationOnly: '운영 대행 중심',
  designBuild: '설계/시공',
  publicTender: '공공 입찰',
};

const contentDevelopmentPattern = /컨텐츠\s*개발|콘텐츠\s*개발|content\s*development|hero\s*컨텐츠|hero\s*콘텐츠|주요\s*전시물\s*컨텐츠|주요\s*전시물\s*콘텐츠|시나리오|스토리라인|내러티브|영상\s*제작|미디어\s*콘텐츠/i;
const boothExhibitionPattern = /부스|전시\s*기획|전시\s*운영|전시장|전시물|전시관|expo|엑스포|exhibition|홍보관|체험관|zoning|동선/i;
const experienceMarketingPattern = /체험\s*마케팅|experiential|experience\s*marketing|인터랙티브|visitor\s*journey|방문객\s*여정|참여형|sns|바이럴|viral|ugc|리워드|reward/i;
const brandActivationPattern = /브랜드\s*액티베이션|brand\s*activation|캠페인|프로모션|론칭|launch|팝업|popup|인지도\s*상승/i;
const operationOnlyPattern = /운영\s*대행|운영\s*용역|operation\s*only|현장\s*운영|인력\s*운영|스태핑|staffing|안전\s*운영|유지\s*관리|maintenance/i;
const designBuildPattern = /설계\s*시공|디자인\s*시공|design\s*build|제작\s*설치|시공|철거|실시설계|공간\s*디자인|제작물\s*납품/i;
const publicTenderPattern = /입찰|조달|나라장터|공고|제안요청서|평가\s*기준|정량\s*평가|정성\s*평가|우선협상|계약|용역/i;

const spatialConstraintPattern = /column|columns|pillar|booth\s*(size|limit|constraint)|venue\s*(layout|limit|constraint)|floor\s*plan|layout\s*constraint|spatial\s*constraint|sightline|moving\s*line|traffic\s*flow|installation\s*limit|기둥|부스\s*(규모|제약|한계|조건)|공간\s*(제약|조건|한계)|행사장\s*(레이아웃|조건|제약)|장소\s*(조건|제약)|평면|동선|시야|시선|설치\s*(제약|조건)|면적|규격/i;
const spatialAllowedSectionPattern = /spatial\s*strategy|zoning|zone|sightline|feasibility|implementation|risk\s*management|risk|layout|floor\s*plan|moving\s*line|traffic\s*flow|공간\s*전략|공간\s*구성|조닝|존|동선|시야|시선|실행\s*가능|구현|리스크|위험|평면|배치|운영\s*관리/i;
const earlyStrategicPurposePattern = /Problem|Insight|Strategy|Concept/i;
const strategicSectionPattern = /proposal\s*thesis|concept\s*name|concept\s*tagline|concept\s*rationale|core\s*message|core\s*concept|market\s*context|project\s*context|core\s*problem|challenge|audience\s*insight|strategic\s*opportunity|strategic\s*direction|제안\s*명제|콘셉트|컨셉|핵심\s*메시지|시장\s*맥락|프로젝트\s*맥락|핵심\s*문제|과제|관람객|타깃\s*인사이트|전략\s*기회|전략\s*방향/i;
const coreConceptPattern = /core\s*concept|핵심\s*(콘셉트|컨셉)/i;
const caseInsightPattern = /case\s*insight|benchmark\s*insight|experience\s*case\s*insight|유사\s*사례\s*인사이트|컨셉\s*도출을\s*위한\s*사례\s*인사이트|콘셉트\s*도출을\s*위한\s*사례\s*인사이트|사례\s*인사이트/i;
const executionBeforeConceptPattern = /media|interactive|content\s*mechanism|spatial\s*(overview|plan)|zoning|zone|layout|visitor\s*journey|experience\s*(principle|overview|structure)|hero\s*(image|content|experience)|key\s*media\s*scene|content\s*modules?|미디어|인터랙티브|콘텐츠\s*메커니즘|공간\s*(개요|구성|전략)|조닝|존|레이아웃|동선|저니|체험\s*(원칙|구조|개요)|히어로\s*(이미지|콘텐츠|체험)|핵심\s*미디어\s*장면|콘텐츠\s*모듈/i;
const postConceptPrinciplePattern = /experience\s*principle|visitor\s*journey|experience\s*journey|visitor\s*experience|체험\s*원칙|방문객\s*여정|관람객\s*여정|방문\s*여정|체험\s*여정/i;
const coverSlidePattern = /cover|title\s*slide|opening|intro|표지|커버|오프닝/i;


function compactText(values: unknown[]): string {
  return values
    .flatMap((value): unknown[] => (Array.isArray(value) ? value : [value]))
    .flatMap((value): unknown[] => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
}

export function inferProposalScopeTypes(input?: ProjectInput, analysis?: Partial<AnalysisResult>): ProposalScopeType[] {
  const text = compactText([
    input?.projectName,
    input?.clientName,
    input?.briefText,
    analysis?.projectOverview,
    analysis?.clientChallenge,
    analysis?.proposalTypeReasoning,
    analysis?.requiredDeliverables,
    analysis?.scopeOfWork,
    analysis?.requiredScope,
    analysis?.requiredItems,
    analysis?.contentCondition,
    analysis?.spatialCondition,
    analysis?.operationCondition,
    analysis?.evaluationCriteria,
    analysis?.taskSections?.flatMap((section) => [section.taskTitle, section.requiredDeliverables, section.keyRequirements, section.constraints, section.schedule]),
  ]);

  const scopes = new Set<ProposalScopeType>(analysis?.proposalScopeTypes ?? []);
  if (contentDevelopmentPattern.test(text)) scopes.add('contentDevelopment');
  if (boothExhibitionPattern.test(text)) scopes.add('boothExhibition');
  if (experienceMarketingPattern.test(text)) scopes.add('experienceMarketing');
  if (brandActivationPattern.test(text)) scopes.add('brandActivation');
  if (operationOnlyPattern.test(text)) scopes.add('operationOnly');
  if (designBuildPattern.test(text)) scopes.add('designBuild');
  if (publicTenderPattern.test(text)) scopes.add('publicTender');

  return Array.from(scopes);
}

export function buildProposalStructureGuard(input?: ProjectInput, analysis?: Partial<AnalysisResult>) {
  const proposalScopeTypes = inferProposalScopeTypes(input, analysis);
  const hasContentBooth = proposalScopeTypes.includes('contentDevelopment') && proposalScopeTypes.includes('boothExhibition');
  const hasExplicitKpi = Boolean((analysis?.numericInfo?.targetKPI ?? []).filter((item) => item.trim()).length) || /KPI|성과\s*지표|정량\s*목표|performance\s*metrics?/i.test((analysis?.evaluationCriteria ?? []).join(' '));
  const operationText = compactText([analysis?.operationCondition, analysis?.scopeOfWork, analysis?.requiredScope, analysis?.taskSections?.flatMap((section) => [section.requiredDeliverables, section.keyRequirements])]);
  const hasExplicitOperationPlan = /부스\s*운영\s*계획|운영\s*계획|현장\s*운영|인력|스태핑|staffing|visitor\s*flow|방문객\s*동선\s*운영|유지\s*관리|maintenance|안전\s*운영|safety/i.test(operationText);

  return {
    proposalScopeTypes,
    maxSlideCount: proposalScopeTypes.includes('contentDevelopment') ? 24 : undefined,
    preferredSlideTypes: hasContentBooth
      ? ['Intro', 'Approach', 'Main Theme', 'Strategy & Goals', 'Hero Content', 'Sub Content', 'Zoning & Flow', 'Schedule', 'Credential']
      : [],
    avoidSlideTypes: hasContentBooth
      ? ['Viral / Communication Strategy', 'KPI / Performance Goal', 'Operation Plan', 'Output & Share', 'Visitor Reward', 'SNS Sharing', 'Marketing Campaign']
      : [],
    hasExplicitKpi,
    hasExplicitOperationPlan,
    copyFocus: proposalScopeTypes.includes('contentDevelopment')
      ? ['content concept', 'narrative', 'media mechanism', 'hero content', 'sub content', 'scenario', 'schedule', 'credential']
      : [],
  };
}

function slideText(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>) {
  return [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage].join(' ');
}

function isSuppressedGenericSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>, guard: ReturnType<typeof buildProposalStructureGuard>) {
  const text = slideText(slide);
  const thesisConnected = /thesis|proposal\s*thesis|명제|핵심\s*주장|전략\s*기회|증명|차별화|impact|임팩트/i.test(text);
  if (/viral|communication|sns|sharing|share|reward|marketing\s*campaign|visitor\s*reward|output\s*&\s*share|바이럴|확산|SNS|공유|리워드|방문객\s*보상|마케팅\s*캠페인/i.test(text) && !thesisConnected) return true;
  if (!guard.hasExplicitKpi && /KPI|performance\s*goal|expected\s*effect|성과\s*지표|성과\s*목표|기대\s*효과/i.test(text)) return true;
  if (!guard.hasExplicitOperationPlan && /operation\s*plan|staffing|onsite|maintenance|safety|운영\s*계획|스태핑|현장\s*운영|유지\s*관리|안전\s*운영/i.test(text)) return true;
  if (!thesisConnected && /budget|company\s*introduction|company\s*capability|vip\s*support|confirmation\s*needs|additional\s*request|schedule|rfp\s*requirement\s*table|media\s*experience\s*overview|content\s*mechanism|예산|회사\s*소개|회사\s*역량|수행\s*역량|VIP\s*지원|확인\s*필요|추가\s*요청|일정|과업\s*대응표|요구사항\s*대응표|미디어\s*경험\s*개요|콘텐츠\s*작동\s*원리/i.test(text)) return true;
  return false;
}

type StrategicGuardContext = {
  selectedConcept?: ConceptCandidate;
  proposalNarrative?: ProposalNarrative;
  conceptDevelopmentLogic?: { proposalThesis?: string };
};

function renumber<T extends SlideOutline | SlideContent>(slides: T[]) {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

function selectedConceptAnchor(context?: StrategicGuardContext) {
  const conceptName = context?.selectedConcept?.conceptName || context?.selectedConcept?.conceptTitle || '핵심 콘셉트';
  const coreMessage = context?.selectedConcept?.coreMessage || context?.selectedConcept?.conceptDefinition || context?.selectedConcept?.oneLineDefinition || '클라이언트 비전과 관람객 인식 전환을 하나의 경험 원칙으로 연결합니다.';
  const thesis = context?.proposalNarrative?.proposalThesis || context?.conceptDevelopmentLogic?.proposalThesis || context?.selectedConcept?.thesisProof || coreMessage;
  return { conceptName, coreMessage, thesis };
}

function isAllowedSpatialConstraintSlide(slide: SlideOutline | SlideContent) {
  return spatialAllowedSectionPattern.test([slide.slideType, slide.slideTitle, slide.slidePurpose, slide.slideRole, slide.keyMessage].filter(Boolean).join(' '));
}

function isEarlyStrategicSlide(slide: SlideOutline | SlideContent, index: number) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose].join(' ');
  return index < 8 || earlyStrategicPurposePattern.test(slide.slidePurpose) || strategicSectionPattern.test(text);
}

function isConstraintDominatedStrategicSlide(slide: SlideOutline | SlideContent, index: number) {
  const text = [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.slideRole, slide.relationToThesis, slide.whyThisSlideExists, slide.keyMessage, slide.mainCopy].filter(Boolean).join(' ');
  return isEarlyStrategicSlide(slide, index) && !isAllowedSpatialConstraintSlide(slide) && spatialConstraintPattern.test(text);
}


type FoundationRole = 'projectMarketContext' | 'coreProblem' | 'audienceInsight' | 'caseInsight' | 'strategicOpportunity' | 'conceptRationale';

const foundationRoles: Array<{ role: FoundationRole; slideType: string; slideTitle: string; slidePurpose: string; pattern: RegExp }> = [
  { role: 'projectMarketContext', slideType: 'Project / Market Context', slideTitle: 'Project / Market Context', slidePurpose: 'Problem', pattern: /project\s*\/\s*market\s*context|market\s*context|project\s*context|project\s*understanding|시장\s*맥락|프로젝트\s*맥락|프로젝트\s*이해/i },
  { role: 'coreProblem', slideType: 'Core Problem', slideTitle: 'Core Problem', slidePurpose: 'Problem', pattern: /core\s*problem|core\s*challenge|challenge|problem|핵심\s*(문제|과제)|문제\s*정의|과제\s*정의/i },
  { role: 'audienceInsight', slideType: 'Audience Insight', slideTitle: 'Audience Insight', slidePurpose: 'Insight', pattern: /audience\s*insight|target\s*insight|visitor\s*insight|관람객\s*인사이트|타깃\s*인사이트|오디언스\s*인사이트/i },
  { role: 'caseInsight', slideType: 'Case Insight', slideTitle: 'Case Insight', slidePurpose: 'Insight', pattern: caseInsightPattern },
  { role: 'strategicOpportunity', slideType: 'Strategic Opportunity', slideTitle: 'Strategic Opportunity', slidePurpose: 'Strategy', pattern: /strategic\s*(opportunity|direction)|strategy\s*opportunity|전략\s*(기회|방향)/i },
  { role: 'conceptRationale', slideType: 'Concept Rationale', slideTitle: 'Concept Rationale', slidePurpose: 'Concept', pattern: /concept\s*rationale|why\s*this\s*concept|콘셉트\s*(도출|필연|근거)|컨셉\s*(도출|필연|근거)/i },
];

function foundationSlideText(slide: SlideOutline) {
  return [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.slideRole, slide.keyMessage].filter(Boolean).join(' ');
}

function isCoreConceptSlide(slide: SlideOutline) {
  return coreConceptPattern.test(foundationSlideText(slide));
}

function isExecutionSlideBeforeConcept(slide: SlideOutline) {
  return executionBeforeConceptPattern.test(foundationSlideText(slide)) && !isCoreConceptSlide(slide) && !foundationRoles.some((item) => item.pattern.test(foundationSlideText(slide)));
}

function createFoundationSlide(role: (typeof foundationRoles)[number], context?: StrategicGuardContext): SlideOutline {
  const { conceptName, coreMessage, thesis } = selectedConceptAnchor(context);
  const rationaleCopy = role.role === 'conceptRationale'
    ? `${conceptName}은 공간/미디어 실행 방식에서 출발한 이름이 아니라, ${thesis}를 관람객이 믿을 수 있는 경험 약속으로 전환하기 위한 전략적 결론입니다.`
    : `${role.slideTitle} 단계는 ${conceptName}을 바로 선언하기 전에 ${thesis}가 왜 필요한지 증명합니다.`;

  return {
    slideNumber: 0,
    slideType: role.slideType,
    slideTitle: role.slideTitle,
    slidePurpose: role.slidePurpose,
    slideRole: `${role.slideTitle}를 통해 Core Concept 이전의 전략적 근거를 세운다.`,
    relationToThesis: `이 장표는 ${thesis}를 Core Concept 선언 전에 단계적으로 입증한다.`,
    whyThisSlideExists: `Core Concept가 실행 방법이나 제약 조건에서 나온 것처럼 보이지 않도록 ${role.slideTitle} 관점의 근거를 먼저 제시한다.`,
    keyMessage: role.role === 'conceptRationale' ? coreMessage : thesis,
    mainCopy: rationaleCopy,
    confirmNeededNote: '',
    sourceEvidence: [],
    referenceAllowed: false,
  };
}

function isCoverSlide(slide: SlideOutline, index: number) {
  return index === 0 && coverSlidePattern.test(foundationSlideText(slide));
}

function isPostConceptPrincipleSlide(slide: SlideOutline) {
  return postConceptPrinciplePattern.test(foundationSlideText(slide)) && !foundationRoles.some((item) => item.pattern.test(foundationSlideText(slide))) && !isCoreConceptSlide(slide);
}

function uniqueSlidesByIdentity(slides: SlideOutline[]) {
  const seen = new Set<SlideOutline>();
  return slides.filter((slide) => {
    if (seen.has(slide)) return false;
    seen.add(slide);
    return true;
  });
}


function createExperiencePrincipleSlide(context?: StrategicGuardContext): SlideOutline {
  const { conceptName, coreMessage, thesis } = selectedConceptAnchor(context);
  return {
    slideNumber: 0,
    slideType: 'Experience Principle / Visitor Journey',
    slideTitle: 'Experience Principle / Visitor Journey',
    slidePurpose: 'Experience',
    slideRole: 'Core Concept 이후 경험 원칙과 방문객 이해 흐름을 연결한다.',
    relationToThesis: `이 장표는 ${conceptName}이 ${thesis}를 관람객 경험으로 전환하는 첫 번째 실행 원칙을 제시한다.`,
    whyThisSlideExists: 'Core Concept 선언 직후 공간·미디어·콘텐츠 상세로 넘어가기 전에 방문객이 어떤 순서로 이해하고 믿게 되는지 정렬한다.',
    keyMessage: coreMessage,
    mainCopy: `${conceptName}은 핵심 메시지를 먼저 이해시키고, 시스템의 연결성을 체감하게 하며, 마지막에는 브랜드 리더십을 신뢰하게 만드는 여정으로 확장됩니다.`,
    confirmNeededNote: '',
    sourceEvidence: [],
    referenceAllowed: false,
  };
}

function enforcePreConceptOrdering(slides: SlideOutline[], context?: StrategicGuardContext) {
  const coreIndex = slides.findIndex(isCoreConceptSlide);
  if (coreIndex < 0) return slides;

  const coreSlide = slides[coreIndex];
  const selectedFoundation: Partial<Record<FoundationRole, SlideOutline>> = {};
  const selectedFoundationSlides = new Set<SlideOutline>();
  const covers: SlideOutline[] = [];
  const preFoundationContext: SlideOutline[] = [];
  const postConceptPrinciples: SlideOutline[] = [];
  const deferredExecution: SlideOutline[] = [];
  const remainder: SlideOutline[] = [];

  slides.forEach((slide, index) => {
    if (index === coreIndex) return;

    const text = foundationSlideText(slide);
    const matchedFoundation = foundationRoles.find((item) => item.pattern.test(text) && !selectedFoundation[item.role]);
    if (matchedFoundation) {
      selectedFoundation[matchedFoundation.role] = slide;
      selectedFoundationSlides.add(slide);
      return;
    }

    if (isCoverSlide(slide, index)) {
      covers.push(slide);
      return;
    }

    if (isPostConceptPrincipleSlide(slide)) {
      postConceptPrinciples.push(slide);
      return;
    }

    if (isExecutionSlideBeforeConcept(slide)) {
      deferredExecution.push(slide);
      return;
    }

    // Preserve non-execution front matter only when it originally appeared before the Core Concept.
    // Strategic/execution slides are normalized into the mandatory foundation order below.
    if (index < coreIndex && !strategicSectionPattern.test(text)) {
      preFoundationContext.push(slide);
      return;
    }

    remainder.push(slide);
  });

  const orderedFoundation = foundationRoles
    .filter((role) => role.role !== 'caseInsight' || selectedFoundation.caseInsight)
    .map((role) => selectedFoundation[role.role] ?? createFoundationSlide(role, context));
  const orderedPostConceptPrinciples = postConceptPrinciples.length ? postConceptPrinciples : [createExperiencePrincipleSlide(context)];

  return uniqueSlidesByIdentity([
    ...covers,
    ...preFoundationContext,
    ...orderedFoundation,
    coreSlide,
    ...orderedPostConceptPrinciples,
    ...remainder.filter((slide) => !selectedFoundationSlides.has(slide) && !foundationRoles.some((role) => role.pattern.test(foundationSlideText(slide)))),
    ...deferredExecution,
  ]);
}

function rewriteConstraintDominatedSlide<T extends SlideOutline | SlideContent>(slide: T, context?: StrategicGuardContext): T {
  const { conceptName, coreMessage, thesis } = selectedConceptAnchor(context);
  const strategicTitle = /problem|challenge|문제|과제/i.test(slide.slidePurpose) ? 'Core Problem / Challenge' : /insight|인사이트/i.test(slide.slidePurpose) ? 'Audience Insight' : /concept|콘셉트|컨셉/i.test(slide.slidePurpose) ? 'Concept Rationale' : 'Strategic Opportunity';
  const titleHasConstraint = spatialConstraintPattern.test([slide.slideTitle, slide.slideType].filter(Boolean).join(' '));
  const base = {
    ...slide,
    slideType: titleHasConstraint ? strategicTitle : slide.slideType,
    slideTitle: titleHasConstraint ? strategicTitle : slide.slideTitle,
    slidePurpose: slide.slidePurpose === 'Concept' || /concept/i.test(slide.slidePurpose) ? 'Concept' : slide.slidePurpose,
    slideRole: '제안 명제와 콘셉트 필연성을 공간 제약이 아닌 관람객 인식 전환 관점에서 설명한다.',
    relationToThesis: `이 장표는 ${conceptName}이 ${thesis}를 증명하는 전략적 이유를 제시한다.`,
    whyThisSlideExists: `공간 조건은 보조 과제로만 다루고, 보이지 않는 시스템 가치·복잡한 value chain·서로 다른 audience 이해 수준·리더십 신뢰 형성을 통해 ${conceptName}의 필연성을 세운다.`,
    keyMessage: coreMessage,
    mainCopy: `${conceptName}은 공간 조건에서 출발한 해법이 아니라, 관람객이 이해하기 어려운 보이지 않는 시스템 가치와 복잡한 브랜드/기술/사업 맥락을 눈에 보이는 경험 구조로 전환하기 위한 전략적 답입니다.`,
    confirmNeededNote: slide.confirmNeededNote || '',
  };

  return base as T;
}

function enforceConstraintPriorityGuard<T extends SlideOutline | SlideContent>(slides: T[], context?: StrategicGuardContext) {
  return slides.map((slide, index) => {
    if (!isConstraintDominatedStrategicSlide(slide, index)) return slide;
    return rewriteConstraintDominatedSlide(slide, context);
  });
}

export function buildConstraintPriorityGuardInstruction() {
  return [
    'Constraint Priority Guard: columns, booth size, venue layout, schedule, operation limits, sightline, moving line, budget, installation limits are spatial planning constraints only.',
    'Spatial constraints may appear only in Spatial Strategy, Zoning, Sightline Planning, Feasibility Proof, or Implementation Risk Management.',
    'Spatial constraints must not be the origin or dominant logic of proposalThesis, conceptName, conceptTagline, conceptRationale, coreMessage, or slide titles before Spatial Strategy.',
    'If an early strategic slide needs to mention constraints, mention them only after the strategic reason has been established and never as the main reason for the concept.',
    'Before Spatial Strategy, columns/booth constraints may be mentioned at most once as a project constraint and must not dominate proposalThesis, conceptRationale, coreMessage, conceptName, or early slide titles.',
  ].join('\n');
}

export function buildSelectedConceptDominanceInstruction() {
  return [
    'Selected Concept Dominance Guard: after a concept is selected, every slide must align with selectedConcept.conceptName, selectedConcept.coreMessage, and proposalNarrative.proposalThesis.',
    'Every slide must answer in slideRole/relationToThesis/whyThisSlideExists: why this slide exists, how it proves the concept or thesis, and what role it plays in the proposal story.',
    'Remove or rewrite slides that cannot prove the selected concept, the core message, or the proposal thesis. Do not include common backend sections by habit.',
  ].join('\n');
}

export function applyProposalStructureGuardToOutline(slides: SlideOutline[], input: ProjectInput, analysis: AnalysisResult, context?: StrategicGuardContext) {
  const guard = buildProposalStructureGuard(input, analysis);
  const isContentDevelopment = guard.proposalScopeTypes.includes('contentDevelopment');
  const filtered = slides.filter((slide) => !isSuppressedGenericSlide(slide, guard));
  const constrained = enforceConstraintPriorityGuard(filtered, context);
  const conceptOrdered = enforcePreConceptOrdering(constrained, context);
  return renumber(conceptOrdered.slice(0, isContentDevelopment ? guard.maxSlideCount ?? conceptOrdered.length : conceptOrdered.length));
}

export function applyProposalStructureGuardToSlides(slides: SlideContent[], input: ProjectInput, analysis: AnalysisResult, context?: StrategicGuardContext) {
  const guard = buildProposalStructureGuard(input, analysis);
  const isContentDevelopment = guard.proposalScopeTypes.includes('contentDevelopment');
  const filtered = slides.filter((slide) => !isSuppressedGenericSlide(slide, guard));
  const constrained = enforceConstraintPriorityGuard(filtered, context);
  return renumber(constrained.slice(0, isContentDevelopment ? guard.maxSlideCount ?? constrained.length : constrained.length));
}
