// Extract factual preset identifiers/capabilities, not printer G-code or profile parameters.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PRINT_DEVICES} from '../src/print-devices.js';

const args=process.argv.slice(2),directory=args[args.indexOf('--profiles-dir')+1],version=args[args.indexOf('--studio-version')+1];
if(!args.includes('--profiles-dir')||!args.includes('--studio-version')||!directory||!/^\d+(?:\.\d+){3}$/.test(version))throw Error('Usage: node scripts/generate-bambu-preset-references.mjs --profiles-dir <profiles directory> --studio-version <four-part version>');
const manifestBytes=await readFile(resolve(directory,'BBL.json')),manifest=JSON.parse(manifestBytes),files=new Map();
for(const category of ['machine','process','filament'])for(const entry of manifest[category+'_list']){
  const data=JSON.parse(await readFile(resolve(directory,'BBL',entry.sub_path),'utf8'));if(data.name!==entry.name)throw Error('Preset manifest/name mismatch: '+entry.name);files.set(entry.name,data);
}
const cache=new Map();
function inherited(name,seen=new Set()){
  if(cache.has(name))return cache.get(name);
  if(seen.has(name)||!files.has(name))throw Error('Unresolved/cyclic preset: '+name);
  const data=files.get(name);seen.add(name);
  const value={...(data.inherits?inherited(data.inherits,seen):{}),...data};cache.set(name,value);return value;
}
const materials={pla:'Generic PLA',petg:'Generic PETG',abs:'Generic ABS',asa:'Generic ASA',tpu:'Generic TPU'},devices={};
for(const device of PRINT_DEVICES.filter(device=>device.name.startsWith('拓竹 '))){
  const model='Bambu Lab '+device.name.slice(3).split('（')[0],nozzles={};
  for(const nozzle of [0.2,0.4,0.6,0.8]){
    const printer=`${model} ${nozzle} nozzle`;if(!files.has(printer))continue;
    const machine=inherited(printer);
    const compatible=(name,type)=>files.get(name).type===type&&files.get(name).instantiation==='true'&&inherited(name).compatible_printers?.includes(printer);
    const processes=[...files.keys()].filter(name=>compatible(name,'process')&&name.includes('Standard'));
    processes.sort((a,b)=>Math.abs(Number(inherited(a).layer_height)-nozzle/2)-Math.abs(Number(inherited(b).layer_height)-nozzle/2)||a.localeCompare(b));
    if(!processes.length)throw Error('No standard process: '+printer);
    const selected={};
    for(const [id,prefix] of Object.entries(materials)){
      const choices=[...files.keys()].filter(name=>compatible(name,'filament')&&(name===prefix||name.startsWith(prefix+' @'))).sort((a,b)=>a.length-b.length||a.localeCompare(b));
      if(choices.length)selected[id]={name:choices[0],type:inherited(choices[0]).filament_type[0]};
    }
    if(!selected.pla)throw Error('No PLA preset: '+printer);
    nozzles[String(nozzle)]={printer,process:processes[0],model:machine.printer_model,height:Number(machine.printable_height),extruderTypes:machine.extruder_type,excludeArea:machine.bed_exclude_area||[],materials:selected};
  }
  if(!Object.keys(nozzles).length)throw Error('No printer presets: '+model);
  devices[device.id]=nozzles;
}
const output={source:'https://github.com/bambulab/BambuStudio/tree/master/resources/profiles/BBL',studioVersion:version,manifestSHA256:createHash('sha256').update(manifestBytes).digest('hex'),devices};
await writeFile(resolve(dirname(fileURLToPath(import.meta.url)),'../src/bambu-preset-references.json'),JSON.stringify(output,null,2)+'\n');
console.log(`Extracted references for ${Object.keys(devices).length} devices from Bambu Studio ${version}`);
