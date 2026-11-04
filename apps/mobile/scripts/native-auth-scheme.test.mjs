import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  nativeAuthSchemes,
  isNativeSellerTrayAuthUrl,
  nativeAuthRedirectUrl,
} from '../src/domain/nativeAuthScheme.ts';
const require = createRequire(import.meta.url);
const production = require('../app.json').expo;
const qa = {
  ...production, name:'SellerTray QA', scheme:['sellertray-qa'],
  android:{...production.android,package:'ng.processedge.sellertray.qa'},
  ios:{...production.ios,bundleIdentifier:'ng.processedge.sellertray.qa'},
};

test('Production keeps its current and legacy links; rejects QA callbacks',()=>{
  assert.deepEqual(nativeAuthSchemes(production),['sellertray','orderdesk']);
  assert.equal(nativeAuthRedirectUrl('auth-confirm',production),'sellertray://auth-confirm');
  assert.equal(nativeAuthRedirectUrl('reset-password',production),'sellertray://reset-password');
  assert.equal(isNativeSellerTrayAuthUrl('sellertray://reset-password#access_token=x',production),true);
  assert.equal(isNativeSellerTrayAuthUrl('orderdesk://reset-password#access_token=x',production),true);
  assert.equal(isNativeSellerTrayAuthUrl('sellertray-qa://reset-password#access_token=x',production),false);
});

test('QA uses its own custom URL scheme for signup and recovery',()=>{
  assert.deepEqual(nativeAuthSchemes(qa),['sellertray-qa']);
  assert.equal(nativeAuthRedirectUrl('auth-confirm',qa),'sellertray-qa://auth-confirm');
  assert.equal(nativeAuthRedirectUrl('reset-password',qa),'sellertray-qa://reset-password');
  assert.equal(isNativeSellerTrayAuthUrl('sellertray-qa://reset-password#access_token=x',qa),true);
  assert.equal(isNativeSellerTrayAuthUrl('sellertray://reset-password#access_token=x',qa),false);
  assert.equal(isNativeSellerTrayAuthUrl('orderdesk://auth-confirm#access_token=x',qa),false);
});

test('unknown or misconfigured QA identity refuses Production Auth links',()=>{
  const qaMissingScheme={...qa,scheme:['sellertray']};
  assert.deepEqual(nativeAuthSchemes(qaMissingScheme),[]);
  assert.equal(isNativeSellerTrayAuthUrl('sellertray://reset-password',qaMissingScheme),false);
  assert.throws(()=>nativeAuthRedirectUrl('reset-password',qaMissingScheme),/scheme is unavailable/);
  assert.deepEqual(nativeAuthSchemes({...qa,android:{package:'com.example.other'},ios:{bundleIdentifier:'com.example.other'},name:'Unknown'}),[]);
});

test('missing Expo Go identity preserves legacy Production fallback without adding QA acceptance',()=>{
  assert.deepEqual(nativeAuthSchemes(null),['sellertray','orderdesk']);
  assert.equal(isNativeSellerTrayAuthUrl('sellertray-qa://reset-password',null),false);
});
