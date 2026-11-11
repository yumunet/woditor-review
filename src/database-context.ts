import type {ReviewFile,Item} from './model';
import {escape,icon} from './ui';
import {metadataHeader,metadataContextText,metadataItem} from './metadata-text';
import {databaseChoicesEnabled,commonChoicesEnabled} from './database-choice-policy';

type ContextField={index:number;source:string|null;translation:string|null};

export function databaseFieldOriginal(file:ReviewFile,item:Item):ContextField|null {
  if(file.type!=='database') return null;
  const slot=file.slots.find(slot=>slot.id===item.slotIds[0]);if(!slot) return null;
  const choice=/^CHOICE_NAME_(\d+)_\d+$/.exec(slot.key);
  const index=choice?.[1]??(slot.kind==='database_csv'?/^CSV_D\d+_ITEM(\d+)$/.exec(slot.key)?.[1]:undefined);
  if(index===undefined) return null;
  const field=Number(index),text=metadataContextText(file,`ITEMNAME${field}`);
  if(!choice) return {index:field,...text};
  const sourceEnabled=databaseChoicesEnabled(metadataHeader(file.jaText,file.type),field);
  const translationEnabled=databaseChoicesEnabled(metadataHeader(file.enText,file.type),field);
  if(!sourceEnabled && !translationEnabled) return null;
  return {index:field,source:sourceEnabled?text.source:null,translation:translationEnabled?text.translation:null};
}

export function commonArgumentOriginal(file:ReviewFile,item:Item):ContextField|null {
  if(file.type!=='common') return null;
  const slot=file.slots.find(slot=>slot.id===item.slotIds[0]);if(!slot) return null;
  const index=/^CHOICE_STR_(\d+)_\d+$/.exec(slot.key)?.[1];if(index===undefined) return null;
  const group=Number(index),text=metadataContextText(file,`VALINPUT_NAME_${group}`);
  const sourceEnabled=commonChoicesEnabled(metadataHeader(file.jaText,file.type),group);
  const translationEnabled=commonChoicesEnabled(metadataHeader(file.enText,file.type),group);
  if(!sourceEnabled && !translationEnabled) return null;
  return {index:group,source:sourceEnabled?text.source:null,translation:translationEnabled?text.translation:null};
}

export function databaseContextView(file:ReviewFile,item:Item,open:boolean):string {
  const common=file.type==='common',field=common?commonArgumentOriginal(file,item):databaseFieldOriginal(file,item);if(!field) return '';
  const heading=common?'対応する引数':'対応する項目',subject=common?'引数名':'項目名';
  const target=metadataItem(file,common?`VALINPUT_NAME_${field.index}`:`ITEMNAME${field.index}`);
  const jump=`<button class="text-act context-item-jump" data-action="context-item" data-value="${escape(target?.id??'')}" ${target?'':'disabled'}>${icon('item-jump')}翻訳項目を開く</button>`;
  const language=(name:string,value:string|null,className:string)=>{
    const empty=value===null?`（${name==='原文'?'対応する': '英訳の'}${subject}がありません）`:`（${name==='原文'?'':'英訳の'}${subject}は未設定）`;
    return `<div class="context-language"><div class="label">${name}</div><div class="text-box ${className} ${value?'':'database-original-empty'}">${escape(value||empty)}</div></div>`;
  };
  return `<section class="database-context" aria-label="${heading}"><button class="context-title" data-action="database-context" aria-expanded="${open}" aria-controls="database-field-original">${heading}<span class="chevron ${open?'open':''}">${open?'閉じる':'開く'}${icon('down')}</span></button>${open?`<div class="database-context-body" id="database-field-original"><div class="context-translations">${language('原文',field.source,'database-original')}${language('英訳',field.translation,'database-translation')}</div>${jump}</div>`:''}</section>`;
}
