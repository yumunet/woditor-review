import type {ReviewFile,Item} from './model';
import {metadataHeader,metadataContextText} from './metadata-text';
import {databaseChoicesEnabled} from './database-choice-policy';
import {escape,icon} from './ui';

function headerKeys(header:string,prefix:string):Map<number,string> {
  const keys=new Map<number,string>();
  for(const match of header.matchAll(new RegExp(`^(${prefix}(\\d+))=`,'gm'))) {
    const index=Number(match[2]);if(Number.isSafeInteger(index)) keys.set(index,match[1]);
  }
  return keys;
}

function choiceRows(file:ReviewFile,item:Item) {
  const slot=file.slots.find(slot=>slot.id===item.slotIds[0]);
  if(!slot || slot.kind!=='metadata' || slot.command) return [];
  const group=file.type==='database'?/^ITEMNAME(\d+)$/.exec(slot.key)?.[1]
    :file.type==='common'?/^VALINPUT_NAME_(\d+)$/.exec(slot.key)?.[1]:undefined;
  if(group===undefined) return [];
  const prefix=`${file.type==='database'?'CHOICE_NAME':'CHOICE_STR'}_${Number(group)}_`;
  const ja=metadataHeader(file.jaText,file.type),en=metadataHeader(file.enText,file.type);
  const sourceEnabled=file.type!=='database'||databaseChoicesEnabled(ja,Number(group));
  const translationEnabled=file.type!=='database'||databaseChoicesEnabled(en,Number(group));
  if(!sourceEnabled && !translationEnabled) return [];
  const sources=headerKeys(ja,prefix),translations=headerKeys(en,prefix);
  const count=(header:string)=>{
    const value=new RegExp(`^${prefix}NUM=([^\\r\\n]*)`,'m').exec(header)?.[1];
    if(value===undefined || !/^\d+$/.test(value)) return undefined;
    const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:undefined;
  };
  const jaCount=count(ja),enCount=count(en);
  return [...new Set([...sources.keys(),...translations.keys()])].sort((a,b)=>a-b).flatMap(index=>{
    const sourceActive=sourceEnabled && (jaCount===undefined?sources.has(index):index<jaCount);
    const translationActive=translationEnabled && (enCount===undefined?translations.has(index):index<enCount);
    if(!sourceActive && !translationActive) return [];
    const sourceKey=sources.get(index)??translations.get(index)!;
    const translationKey=translations.get(index)??sources.get(index)!;
    return [{source:sourceActive?metadataContextText(file,sourceKey).source:null,
      translation:translationActive?metadataContextText(file,translationKey).translation:null}];
  });
}

export function choicesContextView(file:ReviewFile,item:Item,open:boolean):string {
  const choices=choiceRows(file,item);if(!choices.length) return '';
  const cell=(value:string|null)=>value===null?'<span class="choices-empty">（対応なし）</span>':value===''?'<span class="choices-empty">（未設定）</span>':escape(value);
  return `<section class="choices-context" aria-label="選択肢一覧"><button class="context-title" data-action="choices-context" aria-expanded="${open}" aria-controls="choices-context-body">選択肢一覧<span class="chevron ${open?'open':''}">${open?'閉じる':'開く'}${icon('down')}</span></button>${open?`<div class="choices-context-body" id="choices-context-body"><table class="choices-table"><thead><tr><th scope="col">原文</th><th scope="col">英訳</th></tr></thead><tbody>${choices.map(choice=>`<tr class="choice-row"><td class="choice-source">${cell(choice.source)}</td><td class="choice-translation">${cell(choice.translation)}</td></tr>`).join('')}</tbody></table></div>`:''}</section>`;
}
