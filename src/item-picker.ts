import {isDone, sourceText, unresolved, type Item, type ReviewFile} from './model';
import {escape} from './ui';
export function searchedItems(file:ReviewFile,items:Item[],query:string):Item[] {
  if(!query) return items;
  const needle=query.toLocaleLowerCase(),slots=new Map(file.slots.map(s=>[s.id,s]));
  return items.filter(item=>{
    const text=item.slotIds.map(id=>{const s=slots.get(id)!;return sourceText(s)+'\n'+s.translation;}).join('\n')+'\n'+item.changes.filter(c=>c.status==='pending').map(c=>c.after).join('\n');
    return text.toLocaleLowerCase().includes(needle);
  });
}
export function itemRows(file:ReviewFile,items:Item[],currentId:string|null,query:string) {
  return searchedItems(file,items,query).map(item=>{
    const source=item.slotIds.map(id=>sourceText(file.slots.find(s=>s.id===id)!)).join('\n').split(/\r\n|\r|\n/,1)[0];
    return `<button class="pick-row ${item.id===currentId?'active':''}" data-action="pick" data-value="${escape(item.id)}"><span class="dot ${isDone(item)?'done':unresolved(item).length?'comment':''}"></span><span class="pick-text"><span class="pick-title">${escape(item.title)}</span><span class="pick-source">${escape(source)}</span></span><span class="pick-meta">${isDone(item)?'確認済み':'未確認'}</span></button>`;
  }).join('') || `<div class="empty">${query?'検索に一致する項目はありません':'対象の項目はありません'}</div>`;
}
