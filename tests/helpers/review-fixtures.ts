import {createHash} from 'node:crypto';
import type {Command,ReviewFile,Slot} from '../../src/model';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

// Input models for state/exchange tests. No production parser or Python process
// is involved; real TXT -> model -> output contracts are exercised in Python/E2E.
export function reviewFile(path='MapData/TestMap/Event_0000.txt'):ReviewFile {
  const csv=path.includes('DataBase'),missing=path.includes('Unpaired');
  const definitions=csv
    ? [{key:'CSV_D0_ITEM0',source:'説明',translation:'Description',kind:'database_csv',code:null}]
    : [{key:'EVENT_NAME',source:'主人公',translation:'Hero',kind:'metadata',code:null},
       {key:'S1',source:'こんにちは',translation:'Hello',kind:'command_string',code:101},
       {key:'S1',source:'注記の一行目',translation:'First note',kind:'command_string',code:103},
       {key:'S1',source:'注記の二行目',translation:'Second note',kind:'command_string',code:103}];
  const commands:Command[]=[];
  const slots:Slot[]=definitions.map((d,index)=>{
    const line=index+2,id=`L${String(line).padStart(5,'0')}:${d.key}`;
    const command:Command|null=d.code===null?null:{line,enLine:line,code:d.code,kind:d.code===103?'コメント':'文章の表示',depth:0,numbers:[],strings:[d.source],parentCode:null,opaque:false,ja:`表示 ${d.source}`,en:`Display ${d.translation}`,displayLineJa:line+10,displayLineEn:line+10};
    if(command) commands.push(command);
    return {id,line,enLine:line,start:index*30,end:index*30+d.source.length,...d,title:d.key,command,position:command?1:undefined,fingerprint:hash(d.key+'\0'+d.source),warnings:[],...(csv?{csv:{row:0,item:0,dataName:false}}:{})};
  });
  if(missing) {
    const slot=slots[1];slot.source='';slot.sourceMissing=true;slot.translation='Unpaired English';slot.line=-slot.enLine!;slot.start=slot.end=0;
    commands[0].line=slot.line;commands[0].ja='';commands[0].en='Display Unpaired English';
  }
  const jaText=slots.map(s=>s.key+'='+s.source).join('\n'),enText=slots.map(s=>s.key+'='+s.translation).join('\n');
  const items=slots.map(s=>({id:'R:'+s.id,slotIds:[s.id],title:s.title,code:s.command?.code??null,depth:s.command?.depth??null,lastLine:s.line,approved:false,threads:[],changes:[]}));
  if(!csv) {items[2].slotIds.push(slots[3].id);items[2].lastLine=slots[3].line;items.pop();}
  return {path,type:csv?'database':'map',jaText,enText,jaBom:false,enBom:false,sourceVersion:hash(jaText),version:hash(enText),slots,items,commands,usages:{},excluded:[],warnings:[]};
}
