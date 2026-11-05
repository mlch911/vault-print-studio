import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {groupPartColors,replacePartColor,effectivePartColor,validPartColor} from '../src/part-colors.js';

async function harness(){
  let unit={id:'one',colors:{}},selected=null;
  const changes=[],singles=[],messages=[],nodes=new Map();
  const parts=()=>[[1,0,0],[1,0,0],[0,1,0],[0,0,1]].map((color,i)=>({id:'part',key:unit.id+':part:'+i+':0',copy:i,component:0,color}));
  function node(tag='div'){
    return {children:[],attributes:{},style:{},hidden:false,value:'',textContent:'',listeners:{},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      setAttribute(key,value){this.attributes[key]=String(value);},addEventListener(type,fn){this.listeners[type]=fn;},
      fire(type='click',extra={}){return this.listeners[type]?.({type,target:this,preventDefault(){},...extra});},
    };
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};get('color-palette').hidden=true;
  const context=createContext({groupPartColors,replacePartColor,effectivePartColor,validPartColor,
    document:{getElementById:get,createElement:node},getUnit:()=>unit,getParts:parts,getSelected:()=>selected,
    onChange:(keys,color)=>changes.push({keys,color}),onSingleColor:color=>{unit.colors[selected.key]=color;singles.push(color);},notify:message=>messages.push(message),
  });
  const source=(await readFile(new URL('../src/color-palette-ui.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function initColorPalette','function initColorPalette');
  runInContext(source,context);const ui=runInContext('initColorPalette({getUnit,getParts,getSelected,onChange,onSingleColor,notify})',context);
  return {get,ui,changes,singles,messages,getUnit:()=>unit,select:()=>{selected=parts()[0];ui.render();},switchUnit:()=>{unit={id:'two',colors:{}};selected=null;ui.render();}};
}

test('palette opens without a selected part and replaces an entire color with picker or hex input',async()=>{
  const h=await harness();h.get('color-tool').fire();
  assert.equal(h.get('color-palette').hidden,false);assert.equal(h.get('module-color-count').textContent,'3 种颜色');assert.equal(h.get('custom-color').disabled,true);
  const red=h.get('module-color-list').children.find(row=>row.children[1].value==='#FF0000');assert.equal(red.children[2].textContent,'2 个组件');
  red.children[0].value='#00ff00';red.children[0].fire('change');
  assert.deepEqual(h.changes[0],{keys:['one:part:0:0','one:part:1:0'],color:'#00FF00'});
  assert.equal(h.get('module-color-count').textContent,'2 种颜色');
  const green=h.get('module-color-list').children.find(row=>row.children[1].value==='#00FF00');
  green.children[1].value=' #123456 ';green.children[1].fire('keydown',{key:'Enter'});
  assert.equal(h.changes[1].keys.length,3);assert.equal(h.changes[1].color,'#123456');
  assert.equal(h.get('color-tool').attributes['aria-expanded'],'true');h.get('color-tool').fire();assert.equal(h.get('color-tool').attributes['aria-expanded'],'false');
});

test('invalid and stale group editors cannot change colors; single-component coloring stays available',async()=>{
  const h=await harness();h.get('color-tool').fire();
  const row=h.get('module-color-list').children[0];row.children[1].value='bad';row.children[1].fire('change');
  assert.equal(h.changes.length,0);assert.equal(row.children[1].value,'#FF0000');assert.match(h.messages[0],/RRGGBB/);
  h.select();assert.equal(h.get('custom-color').disabled,false);h.get('custom-color').value='#ABCDEF';h.get('custom-color').fire('input');
  assert.deepEqual(h.singles,['#ABCDEF']);assert.equal(h.getUnit().colors['one:part:0:0'],'#ABCDEF');assert.equal(h.getUnit().colors['one:part:1:0'],undefined);
  const stale=h.get('module-color-list').children[0].children[0];h.switchUnit();stale.value='#123456';stale.fire('change');
  assert.deepEqual(h.getUnit().colors,{});assert.equal(h.changes.length,0);
  const closed=h.get('module-color-list').children[0].children[0];h.ui.close();closed.value='#123456';closed.fire('change');assert.deepEqual(h.getUnit().colors,{});
});
