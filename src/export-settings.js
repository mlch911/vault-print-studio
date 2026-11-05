import {normalizePlateOptions} from './print-plates.js';
const KEY='vault-print-studio:export-settings:v1';

export function readExportSettings(){
  try{const saved=JSON.parse(globalThis.localStorage?.getItem(KEY)||'null');return saved?{...normalizePlateOptions(saved),remember:true}:null;}catch{return null;}
}
export function saveExportSettings(options,remember){
  try{
    const storage=globalThis.localStorage;
    if(!storage)return false;
    if(remember)storage.setItem(KEY,JSON.stringify(normalizePlateOptions(options)));
    else storage.removeItem(KEY);
    return true;
  }catch{return false;}
}
