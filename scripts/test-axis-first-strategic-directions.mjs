import fs from 'node:fs';

const route = fs.readFileSync('app/api/concepts/route.ts', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(route.includes('using axis-first current-RFP fallback'), 'route should fall back to axis-first generation instead of returning empty directions');
assert(route.includes('concepts: []') && route.includes('enforceResultMatrixGate'), 'fallback should rebuild cards from direction plan axes');
assert(route.includes('strategicDirections: concepts'), 'success shape should expose strategicDirections array');
assert(route.includes('strategyDiscoveryBrief:'), 'success shape should expose strategyDiscoveryBrief');
assert(route.includes('validationSummary') && route.includes('warningSummary'), 'success shape should expose validation and warning summaries');
assert(route.includes('validateAndRepairDirectionCards'), 'route should repair weak card parts instead of failing whole set');
assert(route.includes('isGenericDirectionLabel') && route.includes('isValidDirectionLabel'), 'proposal-type/generic preset labels should be rejected by validation');
assert(page.includes('conceptResult.strategicDirections?.length ? conceptResult.strategicDirections : conceptResult.concepts'), 'frontend should parse repaired strategicDirections');
assert(page.includes('전략 방향 생성 실패. 분석 결과는 유지됩니다.'), 'frontend should show strategy-stage failure message instead of concept timeout');
console.log('axis-first strategic direction static checks passed');
