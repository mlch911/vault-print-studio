import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotModelCache,restoreModelCache} from '../src/model-cache.js';
import {restoreDirectoryPaths} from '../src/directory-input.js';

test('matching caches retain manual versions and reconnect every match/diagnostic to the recovered File list',async()=>{
  const files=[new File(['a'],'same.stl'),new File(['b'],'same.stl')],matches=new Map([
    ['known',{file:files[0],method:'geometry',variant:{piecesPerFile:2,sourceFrames:[]},aliases:['known'],duplicateFiles:[files[1]]}],
    ['manual',{file:files[1],manual:true,quantityByUnit:{unit:{qty:3,configKey:'config'}}}],
  ]),report={conflicts:[{file:files[0],candidates:[{id:'known'}]}],unmatched:[{file:files[1],path:'right/same.stl'}],invalid:[],duplicates:[],diagnostics:{total:2}};
  const cache=structuredClone(snapshotModelCache(files,matches,report,'catalog-v1'));
  const recovered=restoreDirectoryPaths(files,['left/same.stl','right/same.stl']);
  const result=restoreModelCache({files:recovered,cache},'catalog-v1',new Set(['known','manual']));
  assert.equal(result.matches.get('known').file,recovered[0]);assert.equal(result.matches.get('manual').file,recovered[1]);
  assert.equal(result.unmatched[0].file,recovered[1]);assert.equal(result.conflicts[0].file,recovered[0]);
  assert.equal(await result.matches.get('manual').file.text(),'b');assert.equal(result.matches.get('manual').file.webkitRelativePath,'right/same.stl');
  assert.deepEqual(result.matches.get('known').variant,{piecesPerFile:2,sourceFrames:[]});
  assert.deepEqual(result.matches.get('manual').quantityByUnit,{unit:{qty:3,configKey:'config'}});
  assert.equal(restoreModelCache({files:recovered,cache},'new-catalog',new Set(['known','manual'])),null);
  cache.matches[0].index=99;assert.equal(restoreModelCache({files:recovered,cache},'catalog-v1',new Set(['known','manual'])),null);
});
