import {groupPartColors,replacePartColor,effectivePartColor,validPartColor} from './part-colors.js';

export function initColorPalette({getUnit,getParts,getSelected,onChange,onSingleColor,notify=()=>{}}){
  const $=id=>document.getElementById(id),panel=$('color-palette'),trigger=$('color-tool');
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  let generation=0;
  function close(){generation++;panel.hidden=true;trigger.setAttribute('aria-expanded','false');}
  function render(){
    if(panel.hidden)return;
    const unit=getUnit(),parts=getParts(),groups=unit?groupPartColors(unit,parts):[],ticket=++generation;
    $('module-color-count').textContent=`${groups.length} 种颜色`;
    $('module-color-list').replaceChildren(...groups.map(group=>{
      const row=element('div'),picker=element('input'),hex=element('input'),count=element('span',`${group.keys.length} 个组件`);
      row.className='module-color-row';picker.type='color';picker.value=group.color;
      picker.setAttribute('aria-label',`统一修改 ${group.color} 的 ${group.keys.length} 个组件`);
      hex.type='text';hex.value=group.color;hex.maxLength=7;hex.spellcheck=false;hex.className='module-color-hex';
      hex.setAttribute('aria-label',`替换 ${group.color}，输入十六进制颜色`);
      const apply=value=>{
        if(ticket!==generation||getUnit()?.id!==unit.id)return;
        if(!validPartColor(value)){hex.value=group.color;notify('请输入 #RRGGBB 格式的颜色');return;}
        const keys=replacePartColor(unit,getParts(),group.color,value);
        if(keys.length){onChange(keys,value.toUpperCase());notify(`已统一修改 ${keys.length} 个组件的颜色`);}
        render();
      };
      picker.addEventListener('change',()=>apply(picker.value));
      hex.addEventListener('change',()=>apply(hex.value.trim()));
      hex.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply(hex.value.trim());}});
      row.append(picker,hex,count);return row;
    }));
    $('module-color-empty').hidden=groups.length>0;
    const selected=getSelected();
    $('single-color-hint').textContent=selected?'仅修改当前选中的组件':'先点击模型中的组件，再单独修改颜色';
    $('custom-color').disabled=!selected;
    for(const button of $('color-swatches').children)button.disabled=!selected;
    if(selected&&unit)$('custom-color').value=effectivePartColor(unit,selected);
  }
  trigger.addEventListener('click',()=>{if(panel.hidden){panel.hidden=false;trigger.setAttribute('aria-expanded','true');render();}else close();});
  $('custom-color').addEventListener('input',event=>{if(getSelected()){onSingleColor(event.target.value);render();}});
  const swatches=['#bfc2c4','#252a2c','#ff6b24','#f4efe4','#566c57','#376680'];
  $('color-swatches').replaceChildren(...swatches.map(color=>{
    const button=element('button');button.type='button';button.className='swatch';button.style.background=color;
    button.setAttribute('aria-label',`选中组件配色 ${color}`);
    button.addEventListener('click',()=>{if(getSelected()){onSingleColor(color);render();}});return button;
  }));
  return {render,close};
}
