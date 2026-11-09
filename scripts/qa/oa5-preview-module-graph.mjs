/**
 * Offline-only, deliberately limited graph of JavaScript modules reachable
 * from original HTML script tags. Recognizes literal static and dynamic
 * relative imports, not arbitrary runtime-generated paths/Vite preload maps.
 * It cannot prove that captures came from Vercel or include every loaded chunk.
 */
import {posix} from 'node:path';

const JS=new Set(['.js','.mjs']);

function localPath(from,raw,allowPlain){
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
function htmlScripts(html){
 return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
  .map(m=>m[1]??m[2]);
}
function importedLiterals(js){
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
export function traceCapturedModuleGraph(byRelative,readText,testRef){
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
  for(const raw of importedLiterals(text)){
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
