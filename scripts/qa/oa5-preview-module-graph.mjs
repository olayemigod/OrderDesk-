/**
 * Offline-only, deliberately limited graph of JavaScript modules reachable
 * from original HTML script tags. Recognizes literal static and dynamic
 * relative imports, not arbitrary runtime-generated paths/Vite preload maps.
 * It cannot prove that captures came from Vercel or include every loaded chunk.
 */
import {posix} from 'node:path';
import * as vm from 'node:vm';

const JS=new Set(['.js','.mjs']);

export function localPath(from,raw,allowPlain){
 if(typeof raw!=='string'||!raw||raw.trim()!==raw)return null;
 if(/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(raw))return null;
 const path=raw.split(/[?#]/,1)[0];
 let decoded;
 try{decoded=decodeURIComponent(path);}catch{return null;}
 if(!decoded||decoded.includes('\\')||decoded.includes('\0'))return null;
 if(!allowPlain&&!decoded.startsWith('.')&&!decoded.startsWith('/'))return null;
 const base=decoded.startsWith('/')?'':posix.dirname(from);
 const result=posix.normalize(posix.join(base,decoded.replace(/^\/+/,'')));
 if(!result||result==='.'||result==='..'||result.startsWith('../')||
    result.startsWith('/')||!JS.has(posix.extname(result)))return null;
 return result;
}
/**
 * Categorize a rejected import by *shape only*. Never return the original
 * specifier, hostname, path, query, module name or compiled source.
 *
 * This is a diagnostic, NOT an instruction to fetch/skip the dependency.
 * Rejected imports remain blockers for the protected original capture.
 */
export function classifyUnsupportedImport(raw){
 if(typeof raw!=='string'||!raw||raw.trim()!==raw)return 'malformed';
 if(/^https?:\/\//i.test(raw))return 'remote_http';
 if(raw.startsWith('//'))return 'protocol_relative';
 if(/^[a-z][a-z0-9+.-]*:/i.test(raw))return 'other_scheme';
 if(!raw.startsWith('.')&&!raw.startsWith('/'))return 'bare_specifier';
 if(raw.includes('\\')||raw.includes('\0'))return 'unsafe_local_path';
 const path=raw.split(/[?#]/,1)[0];
 let decoded;
 try{decoded=decodeURIComponent(path);}
 catch{return 'malformed_encoded_path';}
 if(decoded!==path&&(decoded.includes('\\')||decoded.includes('\0')))
  return 'unsafe_local_path';
 if(!/\.(?:js|mjs)$/i.test(decoded))return 'non_js_local_target';
 return 'invalid_or_outside_local_path';
}

export function htmlScripts(html){
 return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
  .map(m=>m[1]??m[2]);
}
export function importedLiterals(js){
 const refs=[];
 for(const regex of [
  /\b(?:import|export)\s*[A-Za-z0-9_$*{},\s]*\bfrom\s*(["'])([^"']+)\1/g,
  /\bimport\s*(["'])([^"']+)\1/g,
  /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
 ]){
  for(const m of js.matchAll(regex))refs.push(m[2]);
 }
 return [...new Set(refs)];
}
/**
 * Parse-only authenticated-capture import audit. VM SourceTextModule proves
 * real static imports, while deliberately malformed in-memory substitutions
 * distinguish regex hits inside comments/strings/regexes from active syntax.
 * Active literal dynamic imports remain in the dependency graph, including
 * unsafe bare/remote forms, which downstream localPath always rejects.
 *
 * This NEVER links/evaluates a module, reads a package, imports a specifier,
 * writes an asset or accesses the network. A parse failure, unavailable VM,
 * or excessive uncorroborated hits always fails closed when requireParser=true.
 * The legacy conservative matcher remains available for offline CI fixtures.
 */
export function auditedImportLiterals(js,{requireParser=false}={}){
 if(typeof js!=='string')throw Error('BLOCKED: invalid captured JavaScript source');
 if(typeof vm.SourceTextModule!=='function'){
  if(requireParser)throw Error('BLOCKED: parse-only V8 modules required for original capture');
  return importedLiterals(js);
 }
 let parsed;
 try{parsed=new vm.SourceTextModule(js,{identifier:'private-preview-parse-only'});}
 catch{
  if(requireParser)throw Error('BLOCKED: captured JS cannot be parsed as a module');
  return importedLiterals(js);
 }
 const statics=[...parsed.dependencySpecifiers];
 const refs=new Set(statics);
 const staticsSet=new Set(statics);
 let uncertain=0;
 for(const regex of [
  /\b(?:import|export)\s*[A-Za-z0-9_$*{},\s]*\bfrom\s*(["'])([^"']+)\1/g,
  /\bimport\s*(["'])([^"']+)\1/g,
  /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g
 ]){
  for(const match of js.matchAll(regex)){
   const ref=match[2];
   if(staticsSet.has(ref))continue;
   if(++uncertain>128)throw Error('BLOCKED: excessive unverified literal module references');
   // An impossible control token invalidates an actual expression, but
   // remains syntactically legal when substituted into inert JS source text.
   // If the result STILL parses, the candidate was not active import syntax.
   const tampered=js.slice(0,match.index)+'\u0001'+js.slice(match.index+match[0].length);
   let inert=false;
   try{
    new vm.SourceTextModule(tampered,{identifier:'private-preview-parse-only'});
    inert=true;
   }catch{
    // Could be real dynamic syntax or an unsafe/ambiguous match. Retain it.
   }
   if(!inert)refs.add(ref);
  }
 }
 return [...refs];
}
export function traceCapturedModuleGraph(byRelative,readText,testRef,requireAuditedParser=false){
 const errors=[],reachable=new Set(),entrypoints=new Set();
 const outcome=()=>({
  errors,
  html_linked_entrypoints:entrypoints.size,
  reachable_js_count:reachable.size,
  reachable_test_ref:[...reachable].some(p=>{
    try{return readText(p).includes(testRef);}catch{return false;}
  }),
 });
 if(!byRelative||typeof byRelative.has!=='function'||typeof readText!=='function'){
  errors.push('Invalid offline module graph input');
  return outcome();
 }
 if(!byRelative.has('index.html')){
  errors.push('Historical capture missing original root index.html');
  return outcome();
 }
 let html;
 try{html=readText('index.html');}
 catch{
  errors.push('Unreadable original root HTML');
  return outcome();
 }
 const refs=htmlScripts(html);
 if(!refs.length)errors.push('Historical root HTML has no script src');
 const queue=[];
 for(const raw of refs){
  const path=localPath('index.html',raw,true);
  if(!path||!byRelative.has(path)){
   errors.push('Historical HTML references absent/unsafe compiled script');
   continue;
  }
  entrypoints.add(path);
  queue.push(path);
 }
 while(queue.length){
  const current=queue.pop();
  if(reachable.has(current))continue;
  if(reachable.size>=2000){
   errors.push('Excessive JavaScript module dependency graph');
   break;
  }
  reachable.add(current);
  let text;
  try{text=readText(current);}
  catch{
   errors.push('Unreadable HTML-linked or imported compiled JavaScript');
   continue;
  }
  let imports;
  try{imports=auditedImportLiterals(text,{requireParser:requireAuditedParser});}
  catch{errors.push('Unverifiable import syntax in captured compiled JavaScript');continue;}
  for(const raw of imports){
   const path=localPath(current,raw,false);
   if(!path||!byRelative.has(path)){
    errors.push('Unresolved or unsafe locally imported JavaScript module');
    continue;
   }
   queue.push(path);
  }
 }
 if(![...reachable].some(p=>{
  try{return readText(p).includes(testRef);}catch{return false;}
 }))errors.push('Test backend ref not visible in HTML-linked entrypoint or reachable imported JavaScript');
 return outcome();
}
