import type {Item,ReviewFile,Slot} from './model';

function csvRow(slot:Slot|undefined):{row:number;name:boolean}|null {
  if(slot?.kind!=='database_csv') return null;
  if(slot.csv) return {row:slot.csv.row,name:slot.csv.dataName};
  const match=/^CSV_D(\d+)_(NAME|ITEM\d+)$/.exec(slot.key);
  return match?{row:Number(match[1]),name:match[2]==='NAME'}:null;
}

// TXT retains its physical cell order. The review list places a row's name
// before its settings, without mutating saved items or reintroducing filters.
export function orderedItems(file:ReviewFile,items:Item[]=file.items):Item[] {
  if(file.type!=='database') return items;
  const slots=new Map(file.slots.map(slot=>[slot.id,slot]));
  const descriptors=new Map(items.map(item=>[item,csvRow(slots.get(item.slotIds[0]))]));
  const names=new Map<number,Item>();
  for(const item of items) {
    const descriptor=descriptors.get(item);
    if(descriptor?.name) names.set(descriptor.row,item);
  }
  const emitted=new Set<Item>(),result:Item[]=[];
  for(const item of items) {
    const descriptor=descriptors.get(item),name=descriptor && names.get(descriptor.row);
    if(name && !emitted.has(name)) {result.push(name);emitted.add(name);}
    if(!emitted.has(item)) {result.push(item);emitted.add(item);}
  }
  return result;
}
