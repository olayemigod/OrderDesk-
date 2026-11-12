/**
 * CI-only checksum-verified fallback for the Kotlin compiler artifacts Maven
 * Central redirects to GitHub Releases. Never trust a mirror checksum:
 * compare downloaded bytes to SHA256 published on official JetBrains GitHub
 * release asset metadata (v2.2.0 and v2.2.10); fail if any byte differs.
 * Fail closed if either source is missing, times out, or disagrees.
 */
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Official GitHub JetBrains/kotlin Releases API assets[].digest, checked 09/11/2026.
// These are reviewed immutable expected hashes, not checksums from the mirror.
export const OFFICIAL_DIGESTS=Object.freeze({
  '2.2.0':'b2f743ea5ba12f69e0f35e5d8d46069d74c8e2861087548a7e0e14a784bc4cf1',
  '2.2.10':'79628fd5d64b4692a62f98962baab00e9076a37e2cffd6ace33cd0b7be7d1cdf',
});
const VERSIONS=Object.freeze(Object.keys(OFFICIAL_DIGESTS));
const ARTIFACT='kotlin-compiler-embeddable';
const PATH='org/jetbrains/kotlin/'+ARTIFACT;
const CENTRAL='https://repo.maven.apache.org/maven2';
const JETBRAINS='https://cache-redirector.jetbrains.com/maven-central';
const EXPECTED_BRANCH='chore/expo-sdk58-dependency-probe-20261108';

export function parseOfficialSha256(source) {
  const normalized=String(source).trim();
  const result=/^([0-9a-fA-F]{64})(?:\s+\*?[\w.-]+)?$/.exec(normalized);
  if (!result) throw new Error('Canonical Maven Central SHA256 is missing or malformed; refuse mirror');
  return result[1].toLowerCase();
}
export function verifyArtifactBytes(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length<1024 || bytes[0]!==0x50 || bytes[1]!==0x4b)
    throw new Error('Compiler download is not a nonempty JAR archive; refuse mirror');
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==expected)throw new Error('JetBrains Kotlin compiler mirror checksum mismatch');
  return actual;
}

function download(url, dest, maxTimeSeconds) {
  const result=spawnSync('curl',[
    '--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https',
    '--connect-timeout','12','--max-time',String(maxTimeSeconds),
    '--retry','1','--retry-delay','2','--retry-all-errors',
    '--output',dest,url
  ],{stdio:['ignore','pipe','pipe'],timeout:(maxTimeSeconds+30)*1000});
  if(result.error || result.status!==0)
    throw new Error('Compiler source unavailable: '+new URL(url).hostname+' '+String(result.stderr||result.error||result.status).slice(0,160));
}

export function main() {
  if (process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_HEAD_REF!==EXPECTED_BRANCH)
    throw new Error('Verified compiler fallback may run only on the dedicated SDK58 PR CI runner');
  const root=process.env.SELLERTRAY_VERIFIED_KOTLIN_REPO;
  const temp=process.env.RUNNER_TEMP;
  if(!root || !temp || resolve(root)!==resolve(temp,'sellertray-kotlin-maven'))
    throw new Error('Verified compiler fallback needs its fixed ephemeral runner directory');
  const scratch=mkdtempSync(join(temp,'sellertray-kotlin-download-'));
  try{
    for(const version of VERSIONS){
      const base=PATH+'/'+version+'/'+ARTIFACT+'-'+version;
      const pomFile=join(scratch,version+'.pom');
      const jarFile=join(scratch,version+'.jar');
      const expected=OFFICIAL_DIGESTS[version];
      download(CENTRAL+'/'+base+'.pom',pomFile,30);
      if(!/^<\?xml|^<project[\s>]/.test(readFileSync(pomFile,'utf8').trim()))
        throw new Error('Official Maven POM response invalid for '+version);
      download(JETBRAINS+'/'+base+'.jar',jarFile,90);
      const bytes=readFileSync(jarFile);
      verifyArtifactBytes(bytes,expected);
      const dir=join(root,PATH,version);mkdirSync(dir,{recursive:true});
      renameSync(pomFile,join(dir,ARTIFACT+'-'+version+'.pom'));
      renameSync(jarFile,join(dir,ARTIFACT+'-'+version+'.jar'));
      console.log('Verified pinned JetBrains release SHA256 for '+ARTIFACT+' '+version+
        ' from JetBrains cache ('+statSync(join(dir,ARTIFACT+'-'+version+'.jar')).size+' bytes)');
    }
    console.log('Compiler mirror accepted for isolated CI runner only; no release inputs changed');
  } finally {
    rmSync(scratch,{recursive:true,force:true});
  }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
