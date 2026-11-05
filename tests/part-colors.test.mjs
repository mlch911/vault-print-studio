import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScene} from '../src/assembly.js';
import {moduleConfig} from '../src/planner.js';
import {groupPartColors,replacePartColor,effectivePartColor} from '../src/part-colors.js';
import {buildPendingExport} from '../src/pending-export.js';
import {sanitizeState} from '../src/state.js';
import {assembledThumbnailKey} from '../src/navigation.js';
import catalog from '../src/catalog.json' with {type:'json'};

const makeUnit=id=>({id,name:id,config:moduleConfig('drawer','S',3,'1F'),colors:{},progress:{}});
const partsFor=unit=>buildScene({...unit.config,id:unit.id,colors:unit.colors}).parts;

test('default module colors form three sRGB groups; full/legacy overrides and case variants use the displayed color',()=>{
  const unit=makeUnit('current'),parts=partsFor(unit),groups=groupPartColors(unit,parts);
  assert.deepEqual(groups.map(g=>g.color).sort(),['#868989','#DDDEDE','#FFA861']);
  assert.equal(groups.reduce((sum,g)=>sum+g.keys.length,0),parts.length);
  const p=parts[0];unit.colors[`${p.id}:${p.copy}:${p.component}`]='#ff0000';
  assert.equal(effectivePartColor(unit,p),'#ff0000');unit.colors[p.key]='#FF0000';
  assert.equal(groupPartColors(unit,[p,{...p,key:'another',color:[1,0,0]}]).length,1);
  unit.colors[p.key]='#0000FF';assert.equal(effectivePartColor(unit,p),'#0000FF');
});

test('bulk replacement changes exactly the current group, merges equal colors and preserves other units/configuration/progress',()=>{
  const unit=makeUnit('current'),other=makeUnit('other'),parts=partsFor(unit),before=structuredClone({config:unit.config,progress:unit.progress,other});
  const groups=groupPartColors(unit,parts),source=groups.find(g=>g.color==='#DDDEDE'),target='#868989';
  const unchanged=parts.filter(p=>!source.keys.includes(p.key)).map(p=>[p.key,effectivePartColor(unit,p)]);
  const thumbBefore=assembledThumbnailKey(unit,1,[]),keys=replacePartColor(unit,parts,'#dddede',target);
  assert.deepEqual(keys,source.keys);assert.equal(groupPartColors(unit,partsFor(unit)).length,2);
  for(const key of source.keys)assert.equal(unit.colors[key],target);
  for(const [key,color] of unchanged)assert.equal(effectivePartColor(unit,parts.find(p=>p.key===key)),color);
  assert.deepEqual({config:unit.config,progress:unit.progress,other},before);
  assert.notEqual(assembledThumbnailKey(unit,1,[]),thumbBefore);
  assert.deepEqual(replacePartColor(unit,parts,target,target.toLowerCase()),[]);
  const saved=structuredClone(unit.colors);assert.throws(()=>replacePartColor(unit,parts,target,'red'),/RRGGBB/);assert.deepEqual(unit.colors,saved);
});

test('bulk colors survive progress serialization and are used by pending 3MF export, including each component/copy',()=>{
  const unit=makeUnit('current'),parts=partsFor(unit),source=groupPartColors(unit,parts).find(g=>g.color==='#DDDEDE');
  replacePartColor(unit,parts,source.color,'#123456');
  const state={version:1,units:[unit],activeUnit:unit.id,plans:[]};
  const restored=sanitizeState(JSON.parse(JSON.stringify(state)),new Set(catalog.map(p=>p.id))).units[0];
  assert.deepEqual(restored.colors,unit.colors);
  const matches=new Map(parts.map(p=>[p.id,{file:new Blob(['synthetic mesh'])}]));
  const result=buildPendingExport(restored,matches,catalog);assert.equal(result.canExport,true);
  assert.ok(result.entries.some(e=>e.copyColors.some(copy=>copy.includes('#123456'))));
  assert.ok(result.entries.every(e=>e.copyColors.every(copy=>copy.every(c=>c.toUpperCase()!=='#DDDEDE'))));
  const freshGroups=groupPartColors(restored,partsFor(restored));assert.ok(freshGroups.some(g=>g.color==='#123456'));
});
