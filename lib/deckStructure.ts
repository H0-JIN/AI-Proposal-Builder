// Deterministic proposal-deck structure engine. Converts a generated outline / slide set into a real proposal deck:
// cover → toc → overview → approach (no concept reveal) → concept → conceptStrategy → content (visual-first) →
// contentDetail → operation → closing. It guarantees a Cover and Table of Contents, assigns each slide a section band,
// derives per-slide layout (ratio / hero / visual weight / text density), derives a strong cover/concept pageSubtitle +
// keyCopy, and strips the final concept name out of the Approach band. All of this is server-side and deterministic, so
// it does NOT depend on the LLM emitting structural fields — only the slide content comes from the model.
import type {
  DeckHeroElement, DeckLayoutRatio, DeckSection, DeckTextDensity, DeckVisualWeight, DesignGuide,
  ProjectInput, ProposalType,
} from './types';
import { normalizeProposalType } from './types';

// The minimum shape a slide must have for the structure pass. Both SlideOutline and SlideContent satisfy it.
export interface DeckSlideLike {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
  slidePurpose: string;
  keyMessage: string;
  mainCopy: string;
  bodyBullets?: string[];
  slideRole?: string;
  relationToThesis?: string;
  whyThisSlideExists?: string;
  slideSection?: DeckSection;
  layoutRatio?: DeckLayoutRatio;
  heroElement?: DeckHeroElement;
  visualWeight?: DeckVisualWeight;
  textDensity?: DeckTextDensity;
  pageSubtitle?: string;
  keyCopy?: string;
}

export interface DeckSlideSeed {
  slideNumber: number;
  slideType: string;
  slideTitle: string;
  slidePurpose: string;
  keyMessage: string;
  mainCopy: string;
  slideSection: DeckSection;
}

const norm = (value?: string) => (value || '').toLowerCase();

const SYNTHESIZED_CONCEPT_SLIDE_TYPE = 'Concept Reveal';
function isConceptRevealSlide(slide: DeckSlideLike): boolean {
  const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
  // The deterministically synthesized reveal carries a dedicated 'Concept Reveal' marker so a re-run ALWAYS re-detects it
  // (idempotent — no duplicate) regardless of how the concept name reads. Checked first.
  if (/concept\s*reveal/.test(t)) return true;
  // 'Concept Rationale' / 후보 도출 etc. are NOT the concept reveal even when their slidePurpose is 'Concept' — the
  // exclusion must run before the purpose signal so the structure guard's rationale slide is never taken as the reveal.
  if (/rationale|도출|후보|candidate|approach|전략\s*방향|opportunity/.test(t)) return false;
  return slide.slidePurpose === 'Concept' || /core\s*concept|핵심\s*콘셉트|컨셉\s*선언|concept\s*declaration|메인\s*컨셉/.test(t);
}
function isApproachSlide(slide: DeckSlideLike): boolean {
  const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
  return slide.slidePurpose === 'Strategy' || /approach|strateg|opportunity|direction|rationale|전략|접근|방향|기회|도출|논리/.test(t);
}
function isClosingSlide(slide: DeckSlideLike): boolean {
  return /closing|conclusion|wrap|클로징|마무리|결론|맺음|thank/.test(norm(`${slide.slideTitle} ${slide.slideType}`));
}
function isOperationSlide(slide: DeckSlideLike): boolean {
  const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
  return slide.slidePurpose === 'Proof' || slide.slidePurpose === 'Impact'
    || /operation|feasibility|schedule|budget|credential|portfolio|organization|staffing|risk|운영|실행|일정|예산|조직|역량|효과|기대\s*효과|expected|kpi|성과/.test(t);
}
function isContentDetailSlide(slide: DeckSlideLike): boolean {
  const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
  return /detail|scenario|module|step|sequence|journey|상세|시나리오|모듈|단계|동선|순서|interaction|operating\s*logic/.test(t);
}
function isConceptStrategySlide(slide: DeckSlideLike): boolean {
  // A concept REVEAL is never the strategy-elaboration slide — guard so a reveal can't be mislabeled conceptStrategy.
  if (isConceptRevealSlide(slide)) return false;
  const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
  return slide.slidePurpose === 'Experience'
    || /strategy|principle|unfold|narrative|structure|전개|원칙|구조|경험\s*전략|spatial\s*strategy|콘텐츠\s*전략|proof\s*structure|증명\s*구조/.test(t);
}

// Layout per section. Before-concept bands are text-led; the concept reveal is a strong hero; after-concept bands are
// visual-first. This is what makes the export read as a proposal deck rather than a uniform analysis card.
const SECTION_LAYOUT: Record<DeckSection, { layoutRatio: DeckLayoutRatio; heroElement: DeckHeroElement; visualWeight: DeckVisualWeight; textDensity: DeckTextDensity }> = {
  cover: { layoutRatio: 'hero-statement', heroElement: 'big-keyword', visualWeight: 'balanced', textDensity: 'low' },
  toc: { layoutRatio: 'text-full', heroElement: 'none', visualWeight: 'text-led', textDensity: 'low' },
  overview: { layoutRatio: 'text-left-visual-right', heroElement: 'big-keyword', visualWeight: 'text-led', textDensity: 'medium' },
  approach: { layoutRatio: 'text-full', heroElement: 'quote', visualWeight: 'text-led', textDensity: 'medium' },
  concept: { layoutRatio: 'hero-statement', heroElement: 'big-keyword', visualWeight: 'balanced', textDensity: 'low' },
  conceptStrategy: { layoutRatio: 'split-50-50', heroElement: 'diagram', visualWeight: 'balanced', textDensity: 'medium' },
  content: { layoutRatio: 'full-bleed-visual', heroElement: 'full-image', visualWeight: 'visual-led', textDensity: 'low' },
  contentDetail: { layoutRatio: 'visual-left-text-right', heroElement: 'diagram', visualWeight: 'visual-led', textDensity: 'medium' },
  operation: { layoutRatio: 'text-left-visual-right', heroElement: 'big-number', visualWeight: 'balanced', textDensity: 'medium' },
  closing: { layoutRatio: 'hero-statement', heroElement: 'big-keyword', visualWeight: 'balanced', textDensity: 'low' },
};

const SECTION_KICKER: Record<DeckSection, string> = {
  cover: '', toc: 'Contents', overview: 'Overview', approach: 'Approach', concept: 'Concept',
  conceptStrategy: 'Concept Strategy', content: 'Content', contentDetail: 'Content Detail', operation: 'Execution', closing: 'Closing',
};

function tokenizeConcept(name: string): string[] {
  return (name || '').split(/[\s/·|,]+/).map((token) => token.replace(/[^가-힣A-Za-z0-9]/g, '')).filter((token) => token.length >= 2);
}

// Remove the final concept name from a text (used to keep the Approach band from revealing the concept early).
function stripConceptTokens(text: string | undefined, tokens: string[]): string {
  if (!text || !tokens.length) return text || '';
  let out = text;
  for (const token of tokens) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Real word boundary for both Latin and Hangul/CJK tokens: not flanked by a letter or digit. This prevents a
    // concept token like "Light"/"Path" from being deleted out of the middle of "delight"/"highlighted".
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), '').trim();
  }
  return out.replace(/\s{2,}/g, ' ').replace(/^[\s,·/-]+|[\s,·/-]+$/g, '').trim();
}

// Strip internal planning meta-labels if the model folded them into user-facing copy (§6: Purpose / Role / Relation to
// Thesis / Why This Slide Exists must not appear as visible labels). Conservative: only drops label-prefixed fragments.
// English keywords must be (essentially) the whole pre-colon label ("Role:" / "Slide Purpose:") so a legitimate line
// like "Role of technology in the pavilion: ..." is NOT stripped. The Korean alternatives are already prefix-scoped.
const META_LABEL = /^\s*(?:\d+[.)]\s*)?(?:slide\s*)?(?:(?:purpose|role|relation\s*to\s*thesis|why\s*this\s*slide\s*exists)\s*[:：]|(?:왜\s*이\s*(?:장표|페이지|슬라이드)[가는이]?\s*존재|이\s*(?:장표|페이지|슬라이드)(?:의|가|는)?\s*(?:역할|목적|존재\s*이유|존재이유|존재하는)|이\s*장표가\s*증명하는\s*것)[^:：\n]*[:：])/i;
function stripMetaLabels(value: string | undefined): string {
  if (!value) return value || '';
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !META_LABEL.test(line))
    .join('\n');
}

function deriveSection(slide: DeckSlideLike, index: number, conceptIdx: number, total: number): DeckSection {
  if (conceptIdx === -1) {
    // No explicit concept reveal detected: split the deck into a before band and an execution band by position.
    if (index <= Math.max(1, Math.floor(total * 0.35))) return isApproachSlide(slide) ? 'approach' : 'overview';
    if (isClosingSlide(slide) || index === total - 1) return 'closing';
    if (isOperationSlide(slide)) return 'operation';
    return isContentDetailSlide(slide) ? 'contentDetail' : 'content';
  }
  if (index < conceptIdx) return isApproachSlide(slide) ? 'approach' : 'overview';
  if (index === conceptIdx) return 'concept';
  if (isClosingSlide(slide) || index === total - 1) return 'closing';
  if (isOperationSlide(slide)) return 'operation';
  if (isContentDetailSlide(slide)) return 'contentDetail';
  if (index <= conceptIdx + 1 || isConceptStrategySlide(slide)) return 'conceptStrategy';
  return 'content';
}

function shortText(value: string | undefined, max: number): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// MAIN PASS. `makeSlide` builds an empty slide of the concrete type (SlideOutline or SlideContent) so cover/toc can be
// synthesized when missing. Idempotent: re-running on already-structured slides keeps the same result.
export function applyDeckStructure<T extends DeckSlideLike>(
  slides: T[],
  opts: {
    finalConceptName: string;
    finalConceptSlogan: string;
    projectName: string;
    clientName: string;
    proposalTypeLabel: string;
    makeSlide: (seed: DeckSlideSeed) => T;
    // Optional concept-page content used only when a dedicated Concept reveal slide must be synthesized (LLM omitted it).
    conceptKoreanSubtitle?: string;
    conceptMeaning?: string;
    conceptWhyThisDirection?: string;
    conceptReframe?: string;
    conceptReferenceInfluence?: string;
    conceptVisualDirection?: string;
  },
): T[] {
  const conceptTokens = tokenizeConcept(opts.finalConceptName);
  // 1) Strip any pre-existing cover/toc the model emitted so we control them deterministically as slide 1 and 2.
  const body = slides.filter((slide) => {
    const t = norm(`${slide.slideTitle} ${slide.slideType}`);
    const isCover = /\bcover\b|표지|타이틀\s*페이지|title\s*page/.test(t);
    const isToc = /table\s*of\s*contents|\btoc\b|목차|agenda|contents\b|index\b/.test(t);
    return !isCover && !isToc;
  });

  // 2) Assign sections + layout to the body slides.
  let conceptIdx = body.findIndex((slide) => isConceptRevealSlide(slide));
  // Fallback: a model-emitted concept declaration that carries BOTH the final concept name in its title AND a concept cue
  // (컨셉/concept/선언/핵심) — and is not an approach/rationale/content/operation slide — IS the reveal. Banding it 'concept'
  // here (before synthesis) stops it from falling through to conceptStrategy and avoids inserting a duplicate reveal.
  if (conceptIdx === -1 && conceptTokens.length) {
    conceptIdx = body.findIndex((slide) => {
      const t = norm(`${slide.slideTitle} ${slide.slideType} ${slide.slideRole}`);
      const hasConceptName = conceptTokens.some((token) => norm(slide.slideTitle).includes(token.toLowerCase()));
      // Unambiguous reveal cues only — NOT the lone token 핵심 (ubiquitous in overview titles: 핵심 가치/메시지/과제); a real
      // "핵심 콘셉트" still matches via 콘셉트. This stops an early overview slide from being grabbed as the reveal.
      const hasConceptCue = /concept|컨셉|콘셉트|선언/.test(t);
      return hasConceptName && hasConceptCue && !isApproachSlide(slide) && !isOperationSlide(slide) && !isContentDetailSlide(slide) && !isClosingSlide(slide);
    });
  }
  // 2a) GUARANTEE a dedicated Concept reveal slide. The required deck is Overview → Approach → CONCEPT → Concept Strategy
  // → Content; if the model never emitted a concept slide (conceptIdx === -1) we synthesize one deterministically and
  // place it right after the Approach/Overview band and before the first Concept Strategy / Content / Execution slide.
  // Idempotent: a re-run detects it via isConceptRevealSlide (slidePurpose 'Concept') and does not insert a duplicate.
  if (conceptIdx === -1 && body.length) {
    // Insert at the before-band / after-band boundary — the SAME 35% split deriveSection uses — so every slide before it
    // bands as overview/approach and every slide after bands as conceptStrategy/content. Keeps Concept strictly after
    // Approach and before Concept Strategy / Content without relying on broad keyword heuristics that can misfire early.
    const insertAt = Math.min(Math.max(1, Math.floor(body.length * 0.35)) + 1, body.length);
    const meaningLines = [
      opts.conceptKoreanSubtitle,
      opts.conceptMeaning && `의미: ${opts.conceptMeaning}`,
      opts.conceptWhyThisDirection && `선택한 전략 방향에 답하는 이유: ${opts.conceptWhyThisDirection}`,
      opts.conceptReframe && `RFP 재해석: ${opts.conceptReframe}`,
      opts.conceptReferenceInfluence && `참고 구조 반영: ${opts.conceptReferenceInfluence}`,
      opts.conceptVisualDirection && `비주얼 디렉션: ${opts.conceptVisualDirection}`,
    ].filter((line): line is string => Boolean(line));
    const conceptSlide = opts.makeSlide({
      slideNumber: insertAt + 1,
      slideType: SYNTHESIZED_CONCEPT_SLIDE_TYPE,
      slideTitle: opts.finalConceptName || '핵심 콘셉트',
      slidePurpose: 'Concept',
      keyMessage: [opts.finalConceptName, opts.finalConceptSlogan].filter(Boolean).join(' — ') || opts.finalConceptName,
      mainCopy: meaningLines.length ? meaningLines.join('\n') : (opts.finalConceptSlogan || opts.finalConceptName),
      slideSection: 'concept',
    });
    body.splice(insertAt, 0, conceptSlide);
    conceptIdx = insertAt;
  }
  const sectioned = body.map((slide, index) => {
    const section = deriveSection(slide, index, conceptIdx, body.length);
    const layout = SECTION_LAYOUT[section];
    const kicker = SECTION_KICKER[section];
    let mainCopy = slide.mainCopy;
    let keyMessage = slide.keyMessage;
    let bodyBullets = slide.bodyBullets;
    // Approach band must NOT reveal the final concept name.
    if (section === 'approach' && conceptTokens.length) {
      mainCopy = stripConceptTokens(mainCopy, conceptTokens) || slide.mainCopy;
      keyMessage = stripConceptTokens(keyMessage, conceptTokens) || slide.keyMessage;
      if (Array.isArray(bodyBullets)) bodyBullets = bodyBullets.map((b) => stripConceptTokens(b, conceptTokens) || b);
    }
    // Strip any leaked internal planning labels (Purpose / Role / Relation to Thesis / Why This Slide Exists).
    mainCopy = stripMetaLabels(mainCopy) || mainCopy;
    keyMessage = stripMetaLabels(keyMessage) || keyMessage;
    if (Array.isArray(bodyBullets)) {
      const keptBullets = bodyBullets.filter((b) => b && !META_LABEL.test(String(b).trim()));
      bodyBullets = keptBullets.length ? keptBullets : bodyBullets;
    }
    // Concept reveal carries the final concept name + slogan as the focal copy.
    const keyCopy = section === 'concept'
      ? [opts.finalConceptName, opts.finalConceptSlogan].filter(Boolean).join(' — ') || slide.keyMessage
      : shortText(slide.keyCopy || slide.keyMessage, 90);
    const pageSubtitle = slide.pageSubtitle || (section === 'concept' && opts.finalConceptSlogan ? shortText(opts.finalConceptSlogan, 80) : kicker);
    return { ...slide, slideSection: section, ...layout, keyCopy, pageSubtitle, keyMessage, mainCopy, ...(bodyBullets ? { bodyBullets } : {}) } as T;
  });

  // 3) Synthesize Cover (slide 1) and Table of Contents (slide 2).
  const sectionsPresent: DeckSection[] = [];
  for (const slide of sectioned) {
    const s = slide.slideSection as DeckSection;
    if (s && !sectionsPresent.includes(s)) sectionsPresent.push(s);
  }
  const tocLines = sectionsPresent
    .filter((s) => s !== 'cover' && s !== 'toc')
    .map((s, i) => `${String(i + 1).padStart(2, '0')}  ${SECTION_KICKER[s]}`);

  const cover = opts.makeSlide({
    slideNumber: 1,
    slideType: 'Cover',
    slideTitle: opts.finalConceptName || opts.projectName,
    slidePurpose: 'Concept',
    keyMessage: opts.finalConceptSlogan || opts.projectName,
    mainCopy: [opts.clientName, opts.proposalTypeLabel].filter(Boolean).join(' · '),
    slideSection: 'cover',
  });
  cover.pageSubtitle = [opts.clientName, opts.proposalTypeLabel].filter(Boolean).join(' · ');
  cover.keyCopy = opts.finalConceptSlogan || opts.finalConceptName || opts.projectName;
  Object.assign(cover, SECTION_LAYOUT.cover);

  const toc = opts.makeSlide({
    slideNumber: 2,
    slideType: 'Table of Contents',
    slideTitle: '목차',
    slidePurpose: 'Strategy',
    keyMessage: 'Contents',
    mainCopy: tocLines.join('\n'),
    slideSection: 'toc',
  });
  toc.pageSubtitle = 'Contents';
  toc.keyCopy = '';
  if (Array.isArray((toc as DeckSlideLike).bodyBullets)) (toc as DeckSlideLike).bodyBullets = tocLines;
  Object.assign(toc, SECTION_LAYOUT.toc);

  return [cover, toc, ...sectioned].map((slide, index) => ({ ...slide, slideNumber: index + 1 }));
}

// Deterministic, proposal-type-themed deck design guide. Pretendard is the default body font.
const TYPE_THEME: Partial<Record<ProposalType, { tone: string; main: string; sub: string; accent: string; image: string }>> = {
  corporate_technology_showcase: { tone: 'editorial, confident, high-contrast, future-tech', main: '0B1F3A', sub: '1D4ED8', accent: '22D3EE', image: 'cinematic 3D render / clean studio photography' },
  multi_entity_pavilion: { tone: 'institutional, unifying, premium', main: '111827', sub: '2563EB', accent: 'F59E0B', image: 'wide architectural photography / system diagrams' },
  exhibition_booth_content: { tone: 'bold, immersive, content-first', main: '15182B', sub: '6D28D9', accent: 'F472B6', image: 'full-bleed experiential photography' },
  visitor_center_tour: { tone: 'warm, trustworthy, human', main: '1F2937', sub: '0F766E', accent: 'F59E0B', image: 'documentary on-site photography' },
  brand_experience: { tone: 'sleek, brand-led, emotive', main: '0F172A', sub: '4338CA', accent: 'F43F5E', image: 'editorial lifestyle photography' },
  mice_event_operation: { tone: 'organized, operational, credible', main: '0F172A', sub: '2563EB', accent: '10B981', image: 'event documentary photography / clean iconography' },
  conference_forum: { tone: 'authoritative, knowledge-led', main: '111827', sub: '1D4ED8', accent: '14B8A6', image: 'stage / session photography' },
  popup_retail_experience: { tone: 'playful, trendy, high-energy', main: '18181B', sub: 'DB2777', accent: 'FACC15', image: 'punchy product / crowd photography' },
};
const DEFAULT_THEME = { tone: 'professional, confident, modern', main: '111827', sub: '2563EB', accent: 'F59E0B', image: 'clean editorial photography' };

export function buildDeckDesignGuide(input: ProjectInput): DesignGuide {
  const type = normalizeProposalType(input.proposalType);
  const theme = TYPE_THEME[type] ?? DEFAULT_THEME;
  return {
    visualTone: theme.tone,
    fontPrimary: 'Pretendard',
    fontSecondary: 'Pretendard SemiBold',
    colorMain: theme.main,
    colorSub: theme.sub,
    colorAccent: theme.accent,
    imageStyle: theme.image,
    iconStyle: 'minimal line icons, 2px stroke, single accent color',
    beforeConceptStyle: '텍스트 주도 · 강한 헤드라인 + 짧은 불릿 · 여백 충분 · 분석/근거 밴드',
    afterConceptStyle: '비주얼 우선 · 히어로 이미지 영역 지배 · 짧은 오버레이 카피 · 실행/콘텐츠 밴드',
  };
}

// Deterministic validation of the assembled deck (used for the §8 booleans / repair decision).
export function validateDeckStructure(slides: DeckSlideLike[], finalConceptName: string) {
  const sectionOf = (i: number) => slides[i]?.slideSection;
  const indexOfSection = (s: DeckSection) => slides.findIndex((slide) => slide.slideSection === s);
  const conceptIdx = indexOfSection('concept');
  const approachIdxs = slides.map((s, i) => (s.slideSection === 'approach' ? i : -1)).filter((i) => i >= 0);
  const conceptTokens = tokenizeConcept(finalConceptName);
  const approachConceptClean = approachIdxs.every((i) => {
    const text = norm(`${slides[i].slideTitle} ${slides[i].keyCopy} ${slides[i].keyMessage} ${slides[i].mainCopy} ${(slides[i].bodyBullets ?? []).join(' ')}`);
    return !conceptTokens.some((token) => text.includes(token.toLowerCase()));
  });
  const firstContentIdx = slides.findIndex((s) => s.slideSection === 'content' || s.slideSection === 'contentDetail');
  return {
    coverSlideExists: sectionOf(0) === 'cover',
    tocSlideExists: sectionOf(1) === 'toc',
    overviewSectionExists: indexOfSection('overview') >= 0,
    approachSectionExists: indexOfSection('approach') >= 0,
    conceptPageExists: conceptIdx >= 0,
    conceptStrategyPageExists: indexOfSection('conceptStrategy') >= 0,
    contentSectionExists: indexOfSection('content') >= 0,
    everySlideHasSection: slides.every((s) => Boolean(s.slideSection)),
    everySlideHasLayoutRatio: slides.every((s) => Boolean(s.layoutRatio)),
    everySlideHasHeroElement: slides.every((s) => Boolean(s.heroElement)),
    approachDoesNotRevealConceptTooEarly: approachConceptClean,
    conceptRevealOrdered: conceptIdx === -1 || approachIdxs.every((i) => i < conceptIdx),
    afterConceptPagesAreVisualFirst: firstContentIdx === -1 || conceptIdx === -1 || firstContentIdx > conceptIdx,
  };
}
