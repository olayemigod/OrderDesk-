import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSha256,prepareWrapperProperties} from './gradle-verified-distribution.mjs';

const old='distributionUrl=https\\\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\nnetworkTimeout=10000\n';
const hash='a'.repeat(64);
test('accepts only a canonical official SHA256 digest',()=>{
 assert.equal(validateSha256(hash.toUpperCase()),hash);
 for(const value of ['HTTP 504','a'.repeat(40),hash+' extra'])assert.throws(()=>validateSha256(value));
});
test('switches only exact SDK58 Gradle wrapper and pins checksum',()=>{
 const next=prepareWrapperProperties(old,hash);
 assert.ok(next.includes('distributionUrl=https\\\\://downloads.gradle.org/distributions/gradle-9.4.1-bin.zip'));
 assert.ok(next.includes('distributionSha256Sum='+hash));
 assert.throws(()=>prepareWrapperProperties(next,hash));
});
test('fails closed for another Gradle version or conflicting digest',()=>{
 assert.throws(()=>prepareWrapperProperties(old.replace('9.4.1','9.5.1'),hash));
 assert.throws(()=>prepareWrapperProperties(old+'distributionSha256Sum='+hash+'\n',hash));
});
