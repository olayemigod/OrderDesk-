import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyDoctor} from './expo-doctor-workspace-gate.mjs';

const fixture=()=>({
  status:1,
  output:'19/20 checks passed. 1 checks failed.\n✖ Check for lock file\nNo lock file detected.\n',
  rootManifest:{workspaces:['apps/mobile','apps/merchant-web']},
  rootLockExists:false,
  mobileManifest:{name:'@sellertray/mobile',dependencies:{expo:'~58.0.23'},devDependencies:{typescript:'~6.0.3'}},
  mobileLock:{lockfileVersion:3,packages:{
    '':{name:'@sellertray/mobile',dependencies:{expo:'~58.0.23'},devDependencies:{typescript:'~6.0.3'}},
    'node_modules/expo':{version:'58.0.23'}
  }},
  installedExpoVersion:'58.0.23'
});

test('fully clean Doctor is accepted',()=> {
  const v=fixture();v.status=0;v.output='20/20 checks passed.';
  assert.equal(classifyDoctor(v).accepted,true);
});
test('single known nested-workspace lock locator false-positive requires an actual matching lock',()=>{
  assert.equal(classifyDoctor(fixture()).accepted,true);
});
test('a second failed Doctor check always blocks even with nested lock',()=>{
  const v=fixture();v.output='18/20 checks passed. 2 checks failed.\n✖ Check for lock file\nNo lock file detected.\n✖ Check Expo config\n';
  assert.equal(classifyDoctor(v).accepted,false);
});
test('missing or drifted real lock always blocks',()=>{
  const v=fixture();v.mobileLock.packages[''].dependencies.expo='~57.0.9';
  assert.equal(classifyDoctor(v).accepted,false);
});
test('unverified install or unexpected SDK always blocks',()=>{
  const v=fixture();v.installedExpoVersion='57.0.28';
  assert.equal(classifyDoctor(v).accepted,false);
});
test('workspace identity or unexpected root lock blocks exception',()=>{
  const v=fixture();v.rootLockExists=true;
  assert.equal(classifyDoctor(v).accepted,false);
  v.rootLockExists=false;v.rootManifest.workspaces=['apps/admin-web'];
  assert.equal(classifyDoctor(v).accepted,false);
});
