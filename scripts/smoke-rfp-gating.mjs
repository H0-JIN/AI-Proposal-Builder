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
assert(/visitor_center_or_tour:\s*\['브랜드 세계관 몰입', '제조\/공정 신뢰 증명'/.test(concepts), 'visitor/tour fallback labels must be brand/process oriented');
assert(!/visitor_center_or_tour:\s*\[[^\]]*(?:통합 아이덴티티|역할 차별화|공동관|국가관)/.test(concepts), 'visitor/tour fallback labels must not include WDS multi-entity labels');
assert(/matrixType !== 'entityDifferentiationMatrix' \|\| primaryRfpConceptType !== 'multi_entity_pavilion'/.test(page), 'Entity Differentiation Matrix panel must be gated by both matrix type and primary RFP type');
assert(/replace\(\/\[…\\\.\]\{2,\}\/g, ''\)/.test(concepts), 'strategic direction labels must strip ellipsis characters');
assert(!/<h3[^>]*>\{getStrategicDirectionLabel\(concept\)\}<\/h3>[\s\S]{0,1200}nameValidationStatus/.test(page), 'debug name validation text must not appear in main card text before accordions');
assert(/<CompactAccordion title="개발 정보 보기">/.test(page), 'card debug fields must be collapsed under 개발 정보 보기');

console.log('PASS: RFP gating and strategic direction UI smoke assertions passed');
