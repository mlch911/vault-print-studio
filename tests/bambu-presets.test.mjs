import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import references from '../src/bambu-preset-references.json' with {type:'json'};
import {bambuPresetReference,createBambuProjectSettings} from '../src/bambu-presets.js';
import {normalizePlateOptions,arrangeColorPlates} from '../src/print-plates.js';

test('selected machine, nozzle, material and process reference matching system presets with explicit inheritance',()=>{
  const options=normalizePlateOptions({deviceId:'p1s',materialId:'petg',nozzle:0.4}),palette=['#FFFFFF','#000000','#FF0000'];
  const project=createBambuProjectSettings(options,palette);
  assert.equal(project.printer_settings_id,'Bambu Lab P1S 0.4 nozzle');assert.equal(project.printer_model,'Bambu Lab P1S');
  assert.equal(project.print_settings_id,'0.20mm Standard @BBL X1C');assert.deepEqual(project.filament_settings_id,Array(3).fill('Generic PETG'));
  assert.deepEqual(project.filament_type,Array(3).fill('PETG'));assert.equal(project.printable_height,'250');
  assert.equal(project.inherits_group.length,5);assert.equal(project.different_settings_to_system.length,5);
  assert.ok(project.different_settings_to_system.every(keys=>keys.length>0&&!keys.includes('gcode')));
  assert.equal(project.different_settings_to_system.at(-1),'printable_area');assert.deepEqual(project.filament_colour,palette);
  assert.ok(Object.keys(project).every(key=>!key.toLowerCase().includes('gcode')));
  assert.throws(()=>createBambuProjectSettings({...options,materialId:undefined},palette),/耗材/);
  assert.throws(()=>createBambuProjectSettings({...options,nozzle:0.2,materialId:'tpu'},palette),/耗材/);
});

test('dual extruders and smaller printers use actual system heights and nozzle counts',()=>{
  const palette=['#FFFFFF'];
  const dual=createBambuProjectSettings(normalizePlateOptions({deviceId:'h2d-single',materialId:'pla',nozzle:0.6}),palette);
  assert.deepEqual(dual.nozzle_diameter,['0.6','0.6']);assert.deepEqual(dual.extruder_type,['Direct Drive','Direct Drive']);assert.equal(dual.printable_height,'325');
  assert.equal(dual.printer_model,'Bambu Lab H2D');assert.match(dual.filament_settings_id[0],/Generic PLA @BBL H2D/);
  const mini=createBambuProjectSettings(normalizePlateOptions({deviceId:'a1-mini',materialId:'pla',nozzle:0.2}),palette);
  assert.equal(mini.printable_height,'180');assert.equal(mini.print_settings_id,'0.10mm Standard @BBL A1M 0.2 nozzle');
});

test('selected P1S packing avoids its front-left cutter area and fails explicitly when a part cannot avoid it',()=>{
  const options=normalizePlateOptions({deviceId:'p1s',nozzle:0.4});
  const part={objectId:1,name:'cutout test',colors:['#FFFFFF'],quantity:8,bbox:[[0,0,0],[20,20,5]]};
  const layout=arrangeColorPlates([part],options);
  for(const item of layout.instances){const [x,y]=item.localTranslation;const minX=item.rotation?x-20:x,minY=y;assert.ok(minX>=23||minY>=33);}
  assert.throws(()=>arrangeColorPlates([{...part,quantity:1,bbox:[[0,0,0],[246,246,5]]}],options),/不可打印区域/);
  assert.throws(()=>arrangeColorPlates([{...part,quantity:1,bbox:[[0,0,0],[20,20,251]]}],options),/250 mm.*打印高度/);
});

test('generated reference map resolves against installed official system presets and compatible printer lists',{
  skip:!process.env.BAMBU_STUDIO_PROFILES,
},async()=>{
  const root=process.env.BAMBU_STUDIO_PROFILES,manifest=JSON.parse(await readFile(resolve(root,'BBL.json'),'utf8')),files=new Map();
  for(const category of ['machine','filament','process'])for(const item of manifest[category+'_list'])files.set(item.name,JSON.parse(await readFile(resolve(root,'BBL',item.sub_path),'utf8')));
  const inherited=name=>{const item=files.get(name);assert.ok(item,name);return {...(item.inherits?inherited(item.inherits):{}),...item};};
  for(const [deviceId,nozzles] of Object.entries(references.devices))for(const [nozzle,ref] of Object.entries(nozzles)){
    assert.equal(bambuPresetReference(deviceId,Number(nozzle)),ref);
    const machine=inherited(ref.printer);assert.equal(machine.instantiation,'true');assert.equal(machine.printer_model,ref.model);
    assert.equal(Number(machine.printable_height),ref.height);assert.deepEqual(machine.extruder_type,ref.extruderTypes);
    assert.equal(inherited(ref.process).instantiation,'true');assert.ok(inherited(ref.process).compatible_printers.includes(ref.printer));
    for(const material of Object.values(ref.materials)){const source=inherited(material.name);assert.equal(source.instantiation,'true');assert.ok(source.compatible_printers.includes(ref.printer));assert.equal(source.filament_type[0],material.type);}
  }
});
