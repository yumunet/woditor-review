import {readSetting,writeSetting} from './storage';
import type {ReviewMode} from './model';
export interface Preferences {
  reviewMode?:ReviewMode;
  contextRadius:number;contextOpen:boolean;contextLanguage:'ja'|'en';
  contextFull:boolean;contextLineNumbers:boolean;contextWrap:boolean;
  databaseContextOpen:boolean;
  choicesContextOpen:boolean;
}
export function preferencesFrom(value:unknown):Preferences {
  const raw=value && typeof value==='object' ? value as Record<string,unknown> : {};
  return {reviewMode:raw.reviewMode==='initial'||raw.reviewMode==='comments'?raw.reviewMode:undefined,
    contextRadius:Number.isInteger(raw.contextRadius) && Number(raw.contextRadius)>=3 && Number(raw.contextRadius)<=10 ? Number(raw.contextRadius):3,
    contextOpen:typeof raw.contextOpen==='boolean'?raw.contextOpen:true,
    contextLanguage:raw.contextLanguage==='ja'?'ja':'en',
    contextFull:raw.contextFull===true,contextLineNumbers:raw.contextLineNumbers===true,
    contextWrap:typeof raw.contextWrap==='boolean'?raw.contextWrap:true,
    databaseContextOpen:typeof raw.databaseContextOpen==='boolean'?raw.databaseContextOpen:true,
    choicesContextOpen:typeof raw.choicesContextOpen==='boolean'?raw.choicesContextOpen:true};
}
export const loadPreferences=async()=>preferencesFrom(await readSetting('ui-preferences'));
let saving=Promise.resolve();
export function savePreferences(preferences:Preferences) {
  const snapshot=structuredClone(preferences);
  saving=saving.catch(()=>{}).then(()=>writeSetting('ui-preferences',snapshot));return saving;
}
