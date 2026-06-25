import { readFileSync } from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../lib/strategicDirectionValidation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText
  .replace(/export function /g, 'function ')
  .replace(/export /g, '');
const mod = new Function('exports', `${js}; return { validateStrategicDirectionLabel, isWeakGenericConceptName };`)({});
const ctx = { clientName: '현대자동차그룹', brandName: 'HTWO', eventName: '수소 전시관', projectName: 'Hydrogen Expo', targetAudience: 'B2B 대상', evidenceAnchors: ['12월', '부스', '전시관'] };
for (const bad of ['HTWO 현대자동차그룹관은', 'HTWO B2B', 'HTWO 12월', 'B2B 대상', '12월 전시 기간', '수소 전시관', '현장감', 'Presence']) {
  assert.equal(mod.validateStrategicDirectionLabel(bad, ctx).valid, false, `${bad} should be rejected`);
}
for (const good of ['기술 현실성 증명', '생태계 신뢰 구조화', '평가 확신 전환']) {
  assert.equal(mod.validateStrategicDirectionLabel(good, ctx).valid, true, `${good} should pass`);
}
assert.equal(mod.isWeakGenericConceptName('Presence'), true);
assert.equal(mod.isWeakGenericConceptName('현장감'), true);
assert.equal(mod.isWeakGenericConceptName('Hydrogen Proof Loop'), false);
console.log('strategic direction validation tests passed');
