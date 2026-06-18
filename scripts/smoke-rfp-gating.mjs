import fs from 'node:fs';

const concepts = fs.readFileSync('app/api/concepts/route.ts', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

assert(/singleBrandVisitorRoomEvidenceCount > 0 && multiEntityEvidenceCount < 2 \? false/.test(concepts), 'visitor room override must block multi_entity_pavilion when fewer than two owner signals exist');
assert(!/const TYPE_SPECIFIC_FALLBACK_LABELS/.test(concepts), 'strategic directions must not be driven by fixed RFP-type fallback label presets');
assert(/buildStrategicDirectionDiscoveryBrief/.test(concepts) && /possibleDirectionAxes/.test(concepts), 'strategic directions must be discovered from an RFP-specific discovery brief');
assert(/matrixType !== 'entityDifferentiationMatrix' \|\| primaryRfpConceptType !== 'multi_entity_pavilion'/.test(page), 'Entity Differentiation Matrix panel must be gated by both matrix type and primary RFP type');
assert(/replace\(\/\[…\\\.\]\{2,\}\/g, ''\)/.test(concepts), 'strategic direction labels must strip ellipsis characters');
assert(!/<h3[^>]*>\{getStrategicDirectionLabel\(concept\)\}<\/h3>[\s\S]{0,1200}nameValidationStatus/.test(page), 'debug name validation text must not appear in main card text before accordions');
assert(/<CompactAccordion title="개발 정보 보기">/.test(page), 'card debug fields must be collapsed under 개발 정보 보기');
assert(/최종 컨셉명 후보/.test(page) && /xl:grid-cols-2/.test(page), 'final naming options must render in a separate readable bottom section');

console.log('PASS: RFP gating and strategic direction UI smoke assertions passed');
