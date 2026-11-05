import {Color} from 'three';

export const validPartColor=color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color);
export const partColorKey=part=>part.key||`${part.id}:${part.copy||0}:${part.component||0}`;

// Match the viewer's full-key override, legacy override, then linear default
// converted to sRGB. Printed/partial shading is deliberately not a source color.
export function effectivePartColor(unit,part){
  const saved=unit.colors?.[partColorKey(part)]||unit.colors?.[`${part.id}:${part.copy||0}:${part.component||0}`];
  return validPartColor(saved)?saved:'#'+new Color(...(part.color||[.65,.66,.66])).getHexString();
}
