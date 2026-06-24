// Deterministic, current-RFP-only extraction of an EXPLICIT concept hierarchy that the RFP itself provides
// (Main Theme / Level structure / Zone Concept / Official Slogan / Key Message / provided concept names ...).
// General marker-based scan — NO hardcoded company/brand/product/exhibition/project names, NO example values.
// When present, this hierarchy is the PRIMARY strategic/naming anchor, ahead of participating entity/brand names.

export interface RfpProvidedConceptHierarchy {
  mainTheme: string;
  subThemes: string[];
  levelStructure: string[];
  zoneConcepts: string[];
  officialSlogan: string;
  keyMessage: string;
  providedConceptNames: string[];
  hierarchyEvidence: string[];
}

// "<marker> : <value>" / "<marker> - <value>" — capture the value up to a line break or a separator.
const VALUE = '\\s*[:\\-–—：]\\s*([^\\n;\\|]{2,120})';
const SINGLE_MARKERS: Array<{ field: 'mainTheme' | 'officialSlogan' | 'keyMessage'; pattern: RegExp }> = [
  { field: 'mainTheme', pattern: new RegExp(`(?:메인\\s*테마|메인\\s*컨셉|main\\s*theme|main\\s*concept|전시\\s*주제|exhibition\\s*theme|exhibition\\s*concept|파빌리온\\s*주제|pavilion\\s*theme|전체\\s*컨셉|overall\\s*concept|대주제|주제문|theme\\s*statement|핵심\\s*주제)${VALUE}`, 'gi') },
  { field: 'officialSlogan', pattern: new RegExp(`(?:공식\\s*슬로건|슬로건|slogan|tagline|태그라인)${VALUE}`, 'gi') },
  { field: 'keyMessage', pattern: new RegExp(`(?:핵심\\s*메시지|핵심\\s*메세지|key\\s*message|main\\s*message|메인\\s*메시지)${VALUE}`, 'gi') },
];
const MULTI_MARKERS: Array<{ field: 'subThemes' | 'levelStructure' | 'zoneConcepts' | 'providedConceptNames'; pattern: RegExp }> = [
  { field: 'subThemes', pattern: new RegExp(`(?:소주제|서브\\s*테마|sub\\s*-?\\s*theme|서브\\s*컨셉|sub\\s*-?\\s*concept)${VALUE}`, 'gi') },
  { field: 'levelStructure', pattern: new RegExp(`(?:컨셉\\s*위계|컨셉\\s*체계|concept\\s*hierarchy|narrative\\s*structure|내러티브\\s*구조|level\\s*\\d|레벨\\s*\\d|\\d\\s*단계|1차\\s*컨셉|2차\\s*컨셉)${VALUE}`, 'gi') },
  { field: 'zoneConcepts', pattern: new RegExp(`(?:존\\s*컨셉|zone\\s*concept|zone\\s*theme|구역\\s*컨셉)${VALUE}`, 'gi') },
  { field: 'providedConceptNames', pattern: new RegExp(`(?:제안\\s*컨셉명|컨셉명|concept\\s*name|제시\\s*컨셉)${VALUE}`, 'gi') },
];

function cleanValue(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/[)\]”"'.,]+$/u, '').trim();
}

// Returns the structured hierarchy ONLY when the current RFP text actually provides hierarchy markers; else undefined.
export function extractRfpConceptHierarchy(rawText?: string): RfpProvidedConceptHierarchy | undefined {
  const text = (rawText || '').slice(0, 60000);
  if (!text.trim()) return undefined;
  const h: RfpProvidedConceptHierarchy = { mainTheme: '', subThemes: [], levelStructure: [], zoneConcepts: [], officialSlogan: '', keyMessage: '', providedConceptNames: [], hierarchyEvidence: [] };

  for (const { field, pattern } of SINGLE_MARKERS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (m) {
      const value = cleanValue(m[1]);
      if (value.length >= 2 && !h[field]) {
        h[field] = value;
        h.hierarchyEvidence.push(cleanValue(m[0]).slice(0, 160));
      }
    }
  }
  for (const { field, pattern } of MULTI_MARKERS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const value = cleanValue(m[1]);
      if (value.length < 2) continue;
      if (!h[field].includes(value)) {
        h[field].push(value);
        h.hierarchyEvidence.push(cleanValue(m[0]).slice(0, 160));
      }
      if (h[field].length >= 8) break;
    }
  }
  h.hierarchyEvidence = Array.from(new Set(h.hierarchyEvidence)).slice(0, 12);

  const detected = Boolean(h.mainTheme || h.officialSlogan || h.keyMessage || h.subThemes.length || h.levelStructure.length || h.zoneConcepts.length || h.providedConceptNames.length);
  return detected ? h : undefined;
}

// Short strategic-value nouns from the hierarchy (theme/sub-theme/zone), used to make deterministic labels theme-anchored.
export function hierarchyThemeSeeds(h?: RfpProvidedConceptHierarchy): string[] {
  if (!h) return [];
  return [h.mainTheme, ...h.subThemes, ...h.zoneConcepts, h.keyMessage].filter(Boolean);
}

// Render the hierarchy as a high-priority prompt anchor block.
export function formatRfpHierarchyAnchor(h: RfpProvidedConceptHierarchy): string {
  return [
    '=== RFP-Provided Concept Hierarchy (현재 RFP가 명시한 공식 컨셉 위계. 모든 전략/네이밍의 1순위 앵커이며 참여 주체/브랜드명보다 우선한다) ===',
    `메인 테마: ${h.mainTheme || '없음'}`,
    `서브 테마: ${h.subThemes.join(' / ') || '없음'}`,
    `레벨/위계 구조: ${h.levelStructure.join(' / ') || '없음'}`,
    `존 컨셉: ${h.zoneConcepts.join(' / ') || '없음'}`,
    `공식 슬로건: ${h.officialSlogan || '없음'}`,
    `핵심 메시지: ${h.keyMessage || '없음'}`,
    `RFP 제공 컨셉명(참고): ${h.providedConceptNames.join(' / ') || '없음'}`,
  ].join('\n');
}
