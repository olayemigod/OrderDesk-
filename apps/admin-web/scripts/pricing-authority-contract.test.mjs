import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const state = readFileSync(new URL('../src/commercial-admin-state.ts', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../src/CommercialAdminWorkspaces.tsx', import.meta.url), 'utf8');

test('commercial onboarding parses server-resolved effective prices separately from price history', () => {
  assert.match(state, /effectivePrices: OnboardingPrice\[\]/);
  assert.match(state, /effectivePrices: parsePrices\(root\.effectivePrices\)/);
  assert.match(state, /prices: parsePrices\(root\.prices\)/);
});

test('initial-purchase preview consumes the governed effective-price projection', () => {
  assert.match(workspace, /findProjectedPrice\(state\.effectivePrices, 'subscription'/);
  assert.match(workspace, /findProjectedPrice\(state\.effectivePrices, 'branch_setup'/);
  assert.doesNotMatch(workspace, /resolveEffectivePrice/);
  assert.doesNotMatch(workspace, /Date\.now\(\)[\s\S]*price\.effectiveFrom/);
});
