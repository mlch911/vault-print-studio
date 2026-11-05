import {Color} from 'three';

export const validPartColor=color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color);
export const partColorKey=part=>part.key||`${part.id}:${part.copy||0}:${part.component||0}`;

// Match the viewer's full-key override, legacy override, then linear default
// converted to sRGB. Printed/partial shading is deliberately not a source color.
export function effectivePartColor(unit,part){
  const saved=unit.colors?.[partColorKey(part)]||unit.colors?.[`${part.id}:${part.copy||0}:${part.component||0}`];
  return validPartColor(saved)?saved:'#'+new Color(...(part.color||[.65,.66,.66])).getHexString();
}

export function groupPartColors(unit,parts){
  const groups=new Map(),seen=new Set();
  for(const part of parts){
    const key=partColorKey(part);if(seen.has(key))continue;seen.add(key);
    const color=effectivePartColor(unit,part).toUpperCase();
    if(!groups.has(color))groups.set(color,{color,keys:[]});
    groups.get(color).keys.push(key);
  }
  return [...groups.values()];
}

export function replacePartColor(unit,parts,source,target){
  if(!validPartColor(source)||!validPartColor(target))throw Error('请输入 #RRGGBB 格式的颜色');
  if(source.toUpperCase()===target.toUpperCase())return [];
  const group=groupPartColors(unit,parts).find(group=>group.color===source.toUpperCase());
  if(!group)return [];
  unit.colors||={};
  for(const key of group.keys)unit.colors[key]=target.toUpperCase();
  return group.keys;
}
