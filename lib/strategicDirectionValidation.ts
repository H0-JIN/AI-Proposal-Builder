export interface StrategicLabelValidationContext {
  clientName?: string;
  brandName?: string;
  eventName?: string;
  projectName?: string;
  targetAudience?: string;
  evidenceAnchors?: string[];
}

const PARTICLE_OR_FRAGMENT_TAIL = /(은|는|이|가|을|를|의|에|에서|으로|로|와|과|및|또는)$/u;
const DATE_OR_SCHEDULE = /(20\d{2}\s*년|\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*[.~\-–]\s*\d{1,2}|Q[1-4]|상반기|하반기|일정|기간|schedule|date)/iu;
const AUDIENCE_CATEGORY = /(B2B|B2C|VIP|바이어|관계자|임직원|학생|일반\s*방문객|방문객|관람객|고객|타깃|타겟|대상|audience|visitor|buyer|customer|stakeholder)s?$/iu;
const RAW_CATEGORY_OR_TYPE = /(제안|기획|운영|구성|개발|제작|설치|시공|디자인|콘텐츠|미디어|영상|부스|전시|행사|이벤트|컨퍼런스|포럼|홍보관|전시관|체험관|쇼룸|공간|프로젝트|사업|산출물|요구사항)$/iu;
const SUBJECT_PLUS_GENERIC_NOUN = /^.{2,24}\s+(?:경험|체험|전시|부스|행사|이벤트|공간|대상|고객|방문객|관람객|일정|기간|프로젝트|제안|콘텐츠|미디어|브랜드|제품|서비스|가치|현장)$/iu;
const STRATEGIC_LENS = /(전환|재정의|증명|실증|확신|신뢰|각인|선언|리더십|포지션|구조화|체계화|차별|설득|이해|기억|태도|인식|관점|렌즈|논리|메커니즘|proof|trust|shift|position|leadership|argument|perception|transformation|signature|category)/iu;
const GENERIC_THEME_NOUN = /^(?:현장감|Presence|연결|전환|경험|체험|가치|신뢰|여정|흐름|공감|몰입|혁신|미래|가능성)$/iu;

function norm(value = '') {
  return value.trim().replace(/\s+/g, ' ');
}

function tokens(value = '') {
  return norm(value).split(/[\s/·|,()[\]{}]+/u).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter(Boolean);
}

function anchorTokens(context: StrategicLabelValidationContext) {
  return [context.clientName, context.brandName, context.eventName, context.projectName, context.targetAudience, ...(context.evidenceAnchors ?? [])]
    .filter(Boolean)
    .flatMap((value) => tokens(String(value)))
    .filter((token) => token.length >= 2);
}

function isAloneOrDominantAnchor(label: string, context: StrategicLabelValidationContext) {
  const labelTokens = tokens(label);
  const anchors = anchorTokens(context);
  if (!labelTokens.length || !anchors.length) return false;
  const anchorHits = labelTokens.filter((token) => anchors.some((anchor) => token.toLowerCase() === anchor.toLowerCase() || token.toLowerCase().includes(anchor.toLowerCase()) || anchor.toLowerCase().includes(token.toLowerCase())));
  if (anchorHits.length === labelTokens.length) return true;
  const nonAnchor = labelTokens.filter((token) => !anchorHits.includes(token));
  return anchorHits.length > 0 && nonAnchor.length <= 1 && nonAnchor.every((token) => RAW_CATEGORY_OR_TYPE.test(token) || AUDIENCE_CATEGORY.test(token) || DATE_OR_SCHEDULE.test(token));
}

export function validateStrategicDirectionLabel(label: string, context: StrategicLabelValidationContext = {}) {
  const value = norm(label);
  const wordCount = tokens(value).length;
  const reasons: string[] = [];
  if (!value) reasons.push('empty_label');
  if (wordCount < 2) reasons.push('not_complete_phrase');
  if (wordCount > 8 || value.length > 48) reasons.push('too_long_or_sentence_fragment');
  if (PARTICLE_OR_FRAGMENT_TAIL.test(value)) reasons.push('ends_with_particle_or_fragment');
  if (DATE_OR_SCHEDULE.test(value)) reasons.push('date_or_schedule_fragment');
  if (AUDIENCE_CATEGORY.test(value)) reasons.push('target_audience_fragment');
  if (isAloneOrDominantAnchor(value, context)) reasons.push('client_brand_event_project_anchor_fragment');
  if (RAW_CATEGORY_OR_TYPE.test(value)) reasons.push('proposal_type_or_category_label');
  if (SUBJECT_PLUS_GENERIC_NOUN.test(value)) reasons.push('subject_plus_generic_noun');
  if (GENERIC_THEME_NOUN.test(value)) reasons.push('generic_abstract_noun');
  if (!STRATEGIC_LENS.test(value)) reasons.push('not_strategic_lens');
  return {
    valid: reasons.length === 0,
    labelIsCompletePhrase: wordCount >= 2 && wordCount <= 8 && !PARTICLE_OR_FRAGMENT_TAIL.test(value),
    labelIsStrategicLens: STRATEGIC_LENS.test(value),
    labelNotRawEvidence: !isAloneOrDominantAnchor(value, context) && !RAW_CATEGORY_OR_TYPE.test(value),
    labelNotDateAudienceClientFragment: !DATE_OR_SCHEDULE.test(value) && !AUDIENCE_CATEGORY.test(value) && !isAloneOrDominantAnchor(value, context),
    labelNotSubjectPlusGenericNoun: !SUBJECT_PLUS_GENERIC_NOUN.test(value),
    reasons,
  };
}

export function isWeakGenericConceptName(name: string) {
  const value = norm(name);
  const wordCount = tokens(value).length;
  if (!value) return true;
  if (GENERIC_THEME_NOUN.test(value)) return true;
  if (wordCount === 1 && /^[A-Za-z가-힣]+$/u.test(value)) return true;
  if (/^(?:presence|connection|shift|flow|journey|experience|moment|trust|value|future|innovation)$/iu.test(value)) return true;
  return false;
}
