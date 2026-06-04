import type { AnalysisResult, ProjectInput, ProposalScopeType, SlideContent, SlideOutline } from '@/lib/types';

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
      ? ['content concept', 'narrative', 'media mechanism', 'hero content', 'sub content', 'scenario', 'reference', 'schedule', 'credential']
      : [],
  };
}

function slideText(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>) {
  return [slide.slideType, slide.slideTitle, slide.slidePurpose, slide.keyMessage].join(' ');
}

function isBlockedContentBoothSlide(slide: Pick<SlideOutline | SlideContent, 'slideType' | 'slideTitle' | 'slidePurpose' | 'keyMessage'>, guard: ReturnType<typeof buildProposalStructureGuard>) {
  const text = slideText(slide);
  if (/viral|communication|sns|sharing|share|reward|marketing\s*campaign|visitor\s*reward|output\s*&\s*share|바이럴|확산|SNS|공유|리워드|방문객\s*보상|마케팅\s*캠페인/i.test(text)) return true;
  if (!guard.hasExplicitKpi && /KPI|performance\s*goal|expected\s*effect|성과\s*지표|성과\s*목표|기대\s*효과/i.test(text)) return true;
  if (!guard.hasExplicitOperationPlan && /operation\s*plan|staffing|onsite|maintenance|safety|운영\s*계획|스태핑|현장\s*운영|유지\s*관리|안전\s*운영/i.test(text)) return true;
  return false;
}

function renumber<T extends SlideOutline | SlideContent>(slides: T[]) {
  return slides.map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

export function applyProposalStructureGuardToOutline(slides: SlideOutline[], input: ProjectInput, analysis: AnalysisResult) {
  const guard = buildProposalStructureGuard(input, analysis);
  const isContentDevelopment = guard.proposalScopeTypes.includes('contentDevelopment');
  const isContentBooth = isContentDevelopment && guard.proposalScopeTypes.includes('boothExhibition');
  const filtered = isContentBooth ? slides.filter((slide) => !isBlockedContentBoothSlide(slide, guard)) : slides;
  return renumber(filtered.slice(0, isContentDevelopment ? guard.maxSlideCount ?? filtered.length : filtered.length));
}

export function applyProposalStructureGuardToSlides(slides: SlideContent[], input: ProjectInput, analysis: AnalysisResult) {
  const guard = buildProposalStructureGuard(input, analysis);
  const isContentDevelopment = guard.proposalScopeTypes.includes('contentDevelopment');
  const isContentBooth = isContentDevelopment && guard.proposalScopeTypes.includes('boothExhibition');
  const filtered = isContentBooth ? slides.filter((slide) => !isBlockedContentBoothSlide(slide, guard)) : slides;
  return renumber(filtered.slice(0, isContentDevelopment ? guard.maxSlideCount ?? filtered.length : filtered.length));
}
