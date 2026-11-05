import references from './bambu-preset-references.json' with {type:'json'};

export const BAMBU_MATERIALS=Object.freeze([{id:'pla',name:'通用 PLA'},{id:'petg',name:'通用 PETG'},{id:'abs',name:'通用 ABS'},{id:'asa',name:'通用 ASA'},{id:'tpu',name:'通用 TPU'}]);

export function bambuPresetReference(deviceId,nozzle){
  const device=references.devices[deviceId];if(!device)return null;
  const preset=device[String(nozzle)];if(!preset)throw Error('该机型没有此喷嘴的官方预设，请选择受支持的喷嘴直径');
  return preset;
}

export function createBambuProjectSettings(options,palette){
  const {width,depth,nozzle}=options;
  const project={version:'02.00.00.00',name:'project_settings',from:'project',printer_technology:'FFF',printer_settings_id:'VAULT 排盘项目（未指定机型）',print_settings_id:'VAULT 排盘（未指定工艺）',filament_settings_id:palette.map(color=>`VAULT ${color}（未指定耗材）`),nozzle_diameter:[String(nozzle)],filament_colour:palette,printable_area:['0x0',`${width}x0`,`${width}x${depth}`,`0x${depth}`],printable_height:'256',flush_volumes_matrix:palette.flatMap((_,i)=>palette.map((_,j)=>i===j?'0':'280'))};
  const reference=bambuPresetReference(options.deviceId,options.nozzle);if(!reference)return project;
  const material=Object.hasOwn(reference.materials,options.materialId)?reference.materials[options.materialId]:null;if(!material)throw Error('请先为所选机型和喷嘴选择耗材预设');
  const types=reference.extruderTypes;
  return {...project,printer_settings_id:reference.printer,print_settings_id:reference.process,filament_settings_id:palette.map(()=>material.name),printer_model:reference.model,printer_variant:String(options.nozzle),printable_height:String(reference.height),nozzle_diameter:types.map(()=>String(options.nozzle)),extruder_type:types,filament_diameter:palette.map(()=>'1.75'),filament_type:palette.map(()=>material.type),bed_exclude_area:reference.excludeArea,filament_map:palette.map(()=>'1'),flush_volumes_matrix:types.flatMap(()=>project.flush_volumes_matrix),
    // Bambu's loader starts from its installed system presets and keeps only
    // these project overrides. A nonempty diff set is required for that merge;
    // otherwise absent machine/G-code fields would overwrite the system preset.
    inherits_group:Array(palette.length+2).fill(''),
    different_settings_to_system:['print_settings_id',...palette.map(()=>'filament_colour'),'printable_area'],
  };
}
