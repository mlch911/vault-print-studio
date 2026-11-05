// File references are indices into the one persisted model list. Rehydrate every
// match/diagnostic with that same File instance so manual matching stays saveable.
export function snapshotModelCache(files,matches,report,catalogKey){
  if(!catalogKey)return undefined;
  const indices=new Map(files.map((file,index)=>[file,index]));
  const entry=value=>{
    const {file,input,duplicateOf,...properties}=value,index=indices.get(file||input?.file);
    if(index===undefined)return null;
    return {index,properties:structuredClone(properties)};
  };
  return {version:1,catalogKey,matches:[...matches].map(([id,match])=>{
    const {file,duplicateFiles,...properties}=match;
    return {id,index:indices.get(file),properties:structuredClone(properties)};
  }),report:Object.fromEntries(['conflicts','unmatched','invalid','duplicates'].map(key=>[key,(report?.[key]||[]).map(entry).filter(Boolean)])),diagnostics:structuredClone(report?.diagnostics||{})};
}

export function restoreModelCache(data,catalogKey,ids){
  const cache=data.cache,files=data.files;
  if(!cache||cache.version!==1||cache.catalogKey!==catalogKey||!Array.isArray(cache.matches)||cache.matches.length>1000)return null;
  const valid=entry=>entry&&Number.isInteger(entry.index)&&entry.index>=0&&entry.index<files.length&&entry.properties&&typeof entry.properties==='object'&&!Array.isArray(entry.properties);
  if(cache.matches.some(entry=>!valid(entry)||!ids.has(entry.id))||new Set(cache.matches.map(entry=>entry.id)).size!==cache.matches.length)return null;
  if(!cache.report||['conflicts','unmatched','invalid','duplicates'].some(key=>!Array.isArray(cache.report[key])||cache.report[key].some(entry=>!valid(entry))))return null;
  const matches=new Map(cache.matches.map(entry=>[entry.id,{...entry.properties,file:files[entry.index],duplicateFiles:[]}]));
  return {...Object.fromEntries(['conflicts','unmatched','invalid','duplicates'].map(key=>[key,cache.report[key].map(entry=>({...entry.properties,file:files[entry.index]}))])),matches,diagnostics:cache.diagnostics||{}};
}
