/**
 * Review-branch-only Gradle distribution custody. Android prebuild generates
 * the official Gradle 9.4.1 wrapper. services.gradle.org sometimes redirects
 * its ZIP to a GitHub release returning HTTP 504. Gradle's own direct
 * downloads.gradle.org host is allowed ONLY with the canonical SHA256 pinned
 * from Gradle's official services.gradle.org checksum endpoint.
 * No Gradle version or build configuration may be changed.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ORIGINAL='distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip';
const DIRECT='distributionUrl=https\\://downloads.gradle.org/distributions/gradle-9.4.1-bin.zip';
const CHECKSUM_URL='https://services.gradle.org/distributions/gradle-9.4.1-bin.zip.sha256';

export function validateSha256(value) {
  const candidate=String(value).trim().toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(candidate))throw new Error('Official Gradle checksum is missing or invalid');
  return candidate;
}
export function prepareWrapperProperties(text,officialDigest){
  const digest=validateSha256(officialDigest);
  if(typeof text!=='string'||text.split(ORIGINAL).length!==2 ||
     /^distributionSha256Sum=/m.test(text) || text.includes(DIRECT))
     throw new Error('Unexpected Android wrapper distribution: refuse update');
  const output=text.replace(ORIGINAL,DIRECT);
  return output.replace(/\s*$/, '\n')+'distributionSha256Sum='+digest+'\n';
}
function fetchOfficialChecksum(){
  const r=spawnSync('curl',['--fail','--location','--silent','--show-error',
    '--proto','=https','--proto-redir','=https','--connect-timeout','10',
    '--max-time','25','--retry','1','--retry-delay','2','--retry-all-errors',CHECKSUM_URL],
   {encoding:'utf8',timeout:45000});
  if(r.error||r.status!==0)
    throw new Error('Cannot retrieve official Gradle SHA256: '+String(r.stderr||r.error||r.status).slice(0,160));
  return validateSha256(r.stdout);
}
export function main(){
  if(process.env.GITHUB_ACTIONS!=='true' ||
     process.env.GITHUB_HEAD_REF!=='chore/expo-sdk58-dependency-probe-20261108')
    throw new Error('Gradle direct-download override is limited to the Expo58 review-branch CI');
  const path=resolve(process.cwd(),'android/gradle/wrapper/gradle-wrapper.properties');
  const before=readFileSync(path,'utf8');
  const sha=fetchOfficialChecksum();
  const after=prepareWrapperProperties(before,sha);
  writeFileSync(path,after);
  console.log('Verified official Gradle SHA256 available for 9.4.1 direct distribution; wrapper checksum enforcement enabled (CI only)');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
