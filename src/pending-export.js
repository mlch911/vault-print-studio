import defaultCatalog from './catalog.json' with {type:'json'};
import {unitBOM,effectiveProgress} from './planner.js';

const validCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000;
const validPieces=value=>Number.isSafeInteger(value)&&value>0&&value<=10000;
const message=value=>typeof value==='string'?value:String(value?.reason||value?.message||value?.name||'配置仍有待确认项');
const readable=file=>file&&Number.isSafeInteger(file.size)&&file.size>0&&typeof file.arrayBuffer==='function'&&typeof file.slice==='function';

/**
 * Snapshot the current unit's complete BOM, independent of UI search/filter state.
 * Quantities count complete, original STL files, never individual mesh components.
 * A blocked result deliberately has no exportable entries: callers must not silently
 * create a partial package. previewEntries is informational only.
 */
export function buildPendingExport(unit,matches=new Map(),catalog=defaultCatalog){
  const issues=[],warnings=[],previewEntries=[];
  const summary={totalTypes:0,completedTypes:0,pendingTypes:0,fileCopies:0,extraPieces:0,unresolvedTypes:0,status:'complete'};
  const result=()=>{
    const distinctIssues=[...new Set(issues)],canExport=!distinctIssues.length&&previewEntries.length>0;
    summary.status=distinctIssues.length?'blocked':canExport?'ready':'complete';
    return {entries:canExport?previewEntries:[],previewEntries,issues:distinctIssues,warnings:[...new Set(warnings)],summary,canExport};
  };
  if(!unit?.config||typeof unit.id!=='string'||!unit.id||!matches||typeof matches.get!=='function'||!Array.isArray(catalog)){
    issues.push('请先选择有效的当前模块，再导出待打印零件。');return result();
  }
  if(unit.progress!==undefined&&(!unit.progress||typeof unit.progress!=='object'||Array.isArray(unit.progress))){
    issues.push('当前模块的打印记录无效，请先检查打印进度。');return result();
  }
  const current={...unit,progress:unit.progress||{}},byId=new Map(catalog.map(item=>[item.id,item]));
  let bom;
  try{bom=unitBOM(current,matches);}catch(error){issues.push('无法读取当前配置：'+message(error));return result();}
  for(const error of bom.errors||[])issues.push('配置错误：'+message(error));
  for(const missing of bom.missing||[])issues.push('配置目录缺少零件：'+message(missing));
  for(const input of bom.needsInput||[])issues.push('请先确认配置：'+message(input));
  warnings.push(...(bom.warnings||[]).map(message));
  const seen=new Set();summary.totalTypes=bom.rows.length;
  if(!bom.rows.length&&!issues.length)issues.push('当前配置没有可导出的打印零件。');
  for(const row of bom.rows){
    const part=byId.get(row.id),name=part?.zh||part?.name||row.id,match=matches.get(row.id);
    if(seen.has(row.id)){issues.push(`${name}：清单含重复零件标识，请检查当前配置。`);summary.unresolvedTypes++;continue;}
    seen.add(row.id);
    const rawRecord=current.progress[row.id];
    if(Object.hasOwn(current.progress,row.id)&&(!rawRecord||typeof rawRecord!=='object'||Array.isArray(rawRecord))){
      issues.push(`${name}：打印记录无效，请先检查打印进度。`);summary.unresolvedTypes++;continue;
    }
    const record=rawRecord||{},printed=record.printed??0;
    if(!validCount(printed)||(Object.hasOwn(record,'piecesPerFile')&&record.piecesPerFile!==null&&!validPieces(record.piecesPerFile))){
      issues.push(`${name}：打印记录或原文件实体数无效，请先检查打印进度。`);summary.unresolvedTypes++;continue;
    }
    if(!Number.isSafeInteger(row.qty)||row.qty<1){
      issues.push(`${name}：请先确认当前配置需要的 STL 份数。`);summary.unresolvedTypes++;continue;
    }
    const progress=effectiveProgress(current,row,matches);
    // Already completed rows do not need a source file to be imported again.
    if(progress.done){summary.completedTypes++;continue;}
    if(progress.pending){
      issues.push(`${name}：已打印记录无法换算为当前版本，请先核对实体数与打印份数。`);summary.unresolvedTypes++;continue;
    }
    const manualConfirmation=match?.quantityByUnit?.[current.id];
    const manualConfirmed=match?.manual===true&&manualConfirmation?.configKey===JSON.stringify(current.config)&&Number.isSafeInteger(manualConfirmation.qty)&&manualConfirmation.qty>=1;
    if((match?.requiresConfirmation||match?.variant?.requiresConfirmation)&&!manualConfirmed){
      issues.push(`${name}：此文件版本需人工确认，请先核对外形与打印份数。`);summary.unresolvedTypes++;continue;
    }
    const perFile=row.piecesPerFile;
    let quantity,remainingPieces=null,extraPieces=0;
    if(validPieces(perFile)){
      // Zero completed files always means zero completed pieces, even when a
      // former manual version recorded unknown piecesPerFile provenance.
      const physicalDone=printed===0?0:progress.physicalDone;
      if(!Number.isSafeInteger(progress.physicalRequired)||progress.physicalRequired<1||!Number.isSafeInteger(physicalDone)||physicalDone<0){
        issues.push(`${name}：实体需求或已打印实体数无效，暂不能导出。`);summary.unresolvedTypes++;continue;
      }
      remainingPieces=Math.max(0,progress.physicalRequired-physicalDone);
      quantity=Math.ceil(remainingPieces/perFile);
      extraPieces=quantity*perFile-remainingPieces;
    }else if(perFile===null&&manualConfirmed&&(printed===0||record.piecesPerFile===null)){
      // An explicit confirmation authorizes complete-file counts even when the
      // internal component count is unknown; known-old/unknown-new progress does not.
      quantity=Math.max(0,row.qty-printed);
    }else{
      issues.push(`${name}：当前文件实体数未知，请先人工确认此版本的 STL 份数。`);summary.unresolvedTypes++;continue;
    }
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000){
      issues.push(`${name}：剩余 STL 份数无效或超过 10,000 份，请检查配置与打印记录。`);summary.unresolvedTypes++;continue;
    }
    summary.pendingTypes++;summary.fileCopies+=quantity;summary.extraPieces+=extraPieces;
    if(extraPieces)warnings.push(`${name}：还需 ${remainingPieces} 个实体，每份 STL 含 ${perFile} 个；导出 ${quantity} 整份会多出 ${extraPieces} 个实体，请在切片软件中核对。`);
    if(!readable(match?.file)){
      issues.push(`${name}：尚未导入可读取的 STL，请先在模型管理中匹配此零件。`);continue;
    }
    previewEntries.push({id:row.id,name,file:match.file,quantity,piecesPerFile:perFile,remainingPieces,extraPieces,requiredFileCopies:row.qty,printedFileCopies:progress.printed});
  }
  return result();
}
