import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('../src/AdminWorkspace.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/SetupSchedulingAdministration.tsx', import.meta.url), 'utf8');
const completion = readFileSync(new URL('../src/SetupCompletionForm.tsx', import.meta.url), 'utf8');

test('OA4 completion and activation recovery are focused Onboarding & Setup destinations', () => {
  for (const route of ['setup/completion', 'setup/activation']) assert.match(workspace, new RegExp(route.replace('/', '\\/')));
  assert.match(workspace, /label: 'Setup Completion'/);
  assert.match(workspace, /label: 'Activation Queue'/);
  assert.match(workspace, /view="completion" showMerchantSelector=\{false\}/);
  assert.match(workspace, /view="activation" showMerchantSelector=\{false\}/);
  assert.match(setup, /type SetupView = 'all' \| 'appointments' \| 'resources' \| 'completion' \| 'activation'/);
});

test('OA4 focused views preserve governed evidence and recovery authority', () => {
  assert.match(setup, /SetupCompletionForm/);
  assert.match(setup, /sellertray\.setupCompletion\.v1/);
  assert.match(setup, /action: 'retry_activation'/);
  assert.match(setup, /showCompletion && \['scheduled','in_progress'\]\.includes/);
  assert.match(setup, /showAppointments && appointment\.status === 'scheduled'/);
  assert.match(completion, /pairingTestResult: 'passed'/);
  assert.match(completion, /testReceiptPrinted: draft\.printed/);
  assert.match(completion, /receivedBy: draft\.receivedBy/);
  assert.match(completion, /acknowledgement: draft\.acknowledgement/);
  assert.doesNotMatch(workspace, /Activate merchant|Activate SellerTray|Mark active/i);
});
