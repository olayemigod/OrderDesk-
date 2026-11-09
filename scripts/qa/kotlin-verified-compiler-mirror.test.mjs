import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseOfficialSha256,verifyArtifactBytes} from './kotlin-verified-compiler-mirror.mjs';

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
