// XY planning areas. Bambu selections also reference installed system presets;
// the planning project never embeds machine start/end G-code.
// Bambu dimensions checked against official specs/Bambu Studio profiles, 2026-11-05.
// H2C: https://blog.bambulab.com/bambu-lab-h2c-where-multi-material-vortek-system-meets-engineering-precision/
// H3C: https://blog.bambulab.com/tool-changer-game-changer-bambu-lab-presents-h3c-the-defining-new-generation-of-3d-printers/
export const PRINT_DEVICES=Object.freeze([
  {id:'a1-mini',series:'拓竹 A 系列',name:'拓竹 A1 mini',width:180,depth:180},
  {id:'a1',series:'拓竹 A 系列',name:'拓竹 A1',width:256,depth:256},
  {id:'a2l',series:'拓竹 A 系列',name:'拓竹 A2L',width:330,depth:320},
  {id:'p1p',series:'拓竹 P 系列',name:'拓竹 P1P',width:256,depth:256},
  {id:'p1s',series:'拓竹 P 系列',name:'拓竹 P1S',width:256,depth:256},
  {id:'p2s',series:'拓竹 P 系列',name:'拓竹 P2S',width:256,depth:256},
  {id:'x1',series:'拓竹 X 系列',name:'拓竹 X1',width:256,depth:256},
  {id:'x1-carbon',series:'拓竹 X 系列',name:'拓竹 X1 Carbon',width:256,depth:256},
  {id:'x1e',series:'拓竹 X 系列',name:'拓竹 X1E',width:256,depth:256},
  {id:'x2d',series:'拓竹 X 系列',name:'拓竹 X2D（主喷嘴范围）',width:256,depth:256},
  {id:'h2s',series:'拓竹 H 系列',name:'拓竹 H2S',width:340,depth:320},
  {id:'h2d-single',series:'拓竹 H 系列',name:'拓竹 H2D（单喷嘴范围）',width:325,depth:320},
  {id:'h2d-pro-single',series:'拓竹 H 系列',name:'拓竹 H2D Pro（单喷嘴范围）',width:325,depth:320},
  {id:'h2c-single',series:'拓竹 H 系列',name:'拓竹 H2C（单喷嘴范围）',width:305,depth:320},
  {id:'h3c',series:'拓竹 H 系列',name:'拓竹 H3C',width:330,depth:320},
  {id:'ender-3-v3-se',series:'其他设备',name:'创想三维 Ender-3 V3 SE',width:220,depth:220},
  {id:'k1-max',series:'其他设备',name:'创想三维 K1 Max',width:300,depth:300},
  {id:'voron-2.4-350',series:'其他设备',name:'Voron 2.4（350 规格）',width:350,depth:350},
].map(device=>Object.freeze(device)));
