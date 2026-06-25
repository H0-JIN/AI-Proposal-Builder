import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync('app/api/concepts/route.ts', 'utf8');
const page = fs.readFileSync('app/page.tsx', 'utf8');

assert.match(route, /function isGenericDirectionLabel/, 'template-like direction validation must remain present');
assert.match(route, /WEAK_DIRECTION_LABEL_PATTERN/, 'weak template-tail labels must be rejected');
assert.match(route, /completeDirectionsFromCurrentEvidence/, 'evidence-derived repair path must be implemented');
assert.match(route, /fallbackCandidate\(index \+ 1, evidenceDerivedDirectionLabel\(planItem\)/, 'missing directions must be repaired from current RFP evidence');
assert.doesNotMatch(route, /under_generation: model returned fewer than 3 strategic directions/, 'under-generation must not immediately fail');
assert.match(route, /repairSource: 'current_rfp_analysis_brand_product_diagnosis_discovery_brief_only'/, 'repair source must be locked to current evidence');
assert.match(route, /proposalTypeUsedOnlyAsGuardrail: true/, 'proposal type must be documented as guardrail only');
assert.match(route, /MAX_DIRECTION_GENERATION_REPAIR_ATTEMPTS/, 'repair path must have an explicit retry/repair limit');
assert.match(route, /buildStrategicDirectionDiscoveryBrief/, 'strategy discovery brief must be built before direction cards');
assert.match(route, /directionValidation: validateDynamicDirections\(concepts\)/, 'final direction validation must run');
assert.match(page, /conceptFailureDetails/, 'UI must keep development-only failure details');
assert.match(page, /<details[^>]+.*개발 상세 보기/s, 'failure details must be collapsed');

console.log('PASS: strategic direction repair static assertions passed');
