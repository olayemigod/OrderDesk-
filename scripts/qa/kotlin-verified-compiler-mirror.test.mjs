import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parseOfficialSha256,verifyArtifactBytes,OFFICIAL_DIGESTS} from './kotlin-verified-compiler-mirror.mjs';

const valid=Buffer.concat([Buffer.from('PK\\x03\\x04','latin1'),Buffer.alloc(1024,1)]);
const digest=createHash('sha256').update(valid).digest('hex');
test('parses canonical Maven SHA256 only',()=>{
  assert.equal(parseOfficialSha256(digest+'  kotlin-compiler-embeddable-2.2.10.jar'),digest);
  assert.throws(()=>parseOfficialSha256('HTTP 504'));
  assert.throws(()=>parseOfficialSha256('a'.repeat(40)));
  assert.throws(()=>parseOfficialSha256('a'.repeat(64)+' extra payload hidden'));
});
test('rejects HTML, shortened JAR and checksum drift',()=>{
  assert.equal(verifyArtifactBytes(valid,digest),digest);
  assert.throws(()=>verifyArtifactBytes(Buffer.from('<html>error</html>'),digest));
  assert.throws(()=>verifyArtifactBytes(Buffer.from('PK'),digest));
  assert.throws(()=>verifyArtifactBytes(valid,'0'.repeat(64)));
});

test('official JetBrains asset digests pinned for both SDK58 Kotlin compiler versions',()=>{
  assert.deepEqual(Object.keys(OFFICIAL_DIGESTS),['2.2.0','2.2.10']);
  for(const digest of Object.values(OFFICIAL_DIGESTS)) assert.match(digest,/^[a-f0-9]{64}$/);
});


test('SDK58 release-mode R8 reuses the exact verified Kotlin compiler CI repository',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/mobile-native-ci.yml',import.meta.url),'utf8');
  const section=workflow.split('      - name: Check release R8 shrinking without assembling or signing an APK\n')[1]?.split('\n      - name: ')[0];
  assert.ok(section,'native R8 step must remain present');
  assert.match(section,/^\s*env:\n\s*SELLERTRAY_VERIFIED_KOTLIN_REPO: \$\{\{ runner\.temp \}\}\/sellertray-kotlin-maven/m);
  assert.match(section,/\b:app:minifyReleaseWithR8\b/);
  assert.match(section,/kotlin-verified-compiler-mirror\.init\.gradle/);
  assert.doesNotMatch(section,/:\s*app:(?:assemble|bundle)Release\b/);
});
