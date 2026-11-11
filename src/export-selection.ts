export interface SelectionRow {key:string;paths:string[]}

export function selectRange(rows:SelectionRow[],anchor:string,end:string,baseline:ReadonlySet<string>,checked:boolean):Set<string> {
  const first=rows.findIndex(row=>row.key===anchor),last=rows.findIndex(row=>row.key===end),next=new Set(baseline);
  if(first<0 || last<0) return next;
  for(const row of rows.slice(Math.min(first,last),Math.max(first,last)+1)) for(const path of row.paths) {
    if(checked) next.add(path);else next.delete(path);
  }
  return next;
}

interface Options {
  paths:()=>string[];
  selected:()=>ReadonlySet<string>;
  change:(selected:Set<string>,preview:boolean)=>void;
}
interface CheckboxRow extends SelectionRow {input:HTMLInputElement;element:HTMLElement}

// Delegate to the app root so re-rendering a panel keeps the Shift anchor.
// Touch previews update checkboxes in place; replacing the DOM would interrupt
// the browser's active touch and its scrolling container.
export function installExportSelection(root:HTMLElement,options:Options) {
  let anchor:string|null=null,scope:string|null=null;
  let timer:ReturnType<typeof setTimeout>|undefined,frame=0,suppressClick=false;
  let gesture:{id:number;x:number;y:number;startX:number;startY:number;active:boolean;
    anchor:string;end:string;checked:boolean;baseline:Set<string>;rows:CheckboxRow[];body:HTMLElement;stamp:number}|null=null;
  const rows=():CheckboxRow[]=>[...root.querySelectorAll<HTMLInputElement>('.export-tree input[type=checkbox]')]
    .filter(input=>input.getClientRects().length>0).map(input=>({input,element:input.closest<HTMLElement>('.export-row')!,
      key:input.dataset.exportPath?'file:'+input.dataset.exportPath:'folder:'+input.dataset.exportFolder,
      paths:input.dataset.exportPath?[input.dataset.exportPath]:options.paths().filter(path=>path.startsWith(input.dataset.exportFolder+'/'))}));
  const rowAt=(target:EventTarget|null,list:CheckboxRow[])=>{
    if(!(target instanceof Element) || target.closest('.export-toggle')) return;
    const row=target.closest('.export-row');return list.find(entry=>entry.element===row);
  };
  const resetScope=()=>{
    const panel=root.querySelector('.sheet')?.getAttribute('aria-label')??null;
    if(panel!==scope) anchor=null;
    scope=panel;
  };
  const cancel=()=>{clearTimeout(timer);cancelAnimationFrame(frame);gesture=null;root.querySelector('.export-tree')?.classList.remove('range-selecting');};
  const preview=()=>{
    const current=gesture;if(!current?.active) return;
    const box=current.body.getBoundingClientRect();
    const target=document.elementFromPoint(Math.max(box.left+1,Math.min(current.x,box.right-1)),Math.max(box.top+1,Math.min(current.y,box.bottom-1)));
    const row=rowAt(target,current.rows);if(row) current.end=row.key;
    options.change(selectRange(current.rows,current.anchor,current.end,current.baseline,current.checked),true);
  };
  const scroll=(stamp:number)=>{
    const current=gesture;if(!current?.active) return;
    const box=current.body.getBoundingClientRect(),edge=Math.min(48,box.height/4);
    const speed=current.y<box.top+edge?-Math.min(1,(box.top+edge-current.y)/edge):current.y>box.bottom-edge?Math.min(1,(current.y-box.bottom+edge)/edge):0;
    const elapsed=current.stamp?Math.min(40,stamp-current.stamp):16;current.stamp=stamp;
    if(speed) {current.body.scrollTop+=speed*elapsed*.8;preview();}
    frame=requestAnimationFrame(scroll);
  };
  root.addEventListener('pointerdown',()=>{suppressClick=false;},true);
  root.addEventListener('click',event=>{
    if(!(event.target as Element).closest('.export-tree')) return;
    const list=rows(),row=rowAt(event.target,list);if(!row) return;
    if(suppressClick) {event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
    resetScope();
    if(!event.shiftKey) return;
    const checked=event.target===row.input?row.input.checked:!row.input.checked||row.input.indeterminate;
    event.preventDefault();event.stopImmediatePropagation();
    const start=list.some(row=>row.key===anchor)?anchor!:row.key;
    options.change(selectRange(list,start,row.key,options.selected(),checked),false);
    anchor=start;
  },true);
  root.addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;
    if(input.id==='export-all') {anchor=null;return;}
    if(!input.closest('.export-tree')) return;
    const row=rows().find(row=>row.input===input);if(!row) return;
    resetScope();anchor=row.key;event.stopImmediatePropagation();
    options.change(selectRange([row],row.key,row.key,options.selected(),input.checked),false);
  },true);
  root.addEventListener('touchstart',event=>{
    cancel();suppressClick=false;
    if(event.touches.length!==1 || !(event.target as Element).closest('.export-tree')) return;
    const list=rows(),row=rowAt(event.target,list),touch=event.touches[0];if(!row) return;
    const body=row.element.closest<HTMLElement>('.sheet-body');if(!body) return;
    resetScope();
    gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,startX:touch.clientX,startY:touch.clientY,
      active:false,anchor:row.key,end:row.key,checked:!row.input.checked||row.input.indeterminate,
      baseline:new Set(options.selected()),rows:list,body,stamp:0};
    timer=setTimeout(()=>{
      if(!gesture) return;
      gesture.active=true;anchor=gesture.anchor;root.querySelector('.export-tree')?.classList.add('range-selecting');
      preview();frame=requestAnimationFrame(scroll);
    },450);
  },{passive:true});
  root.addEventListener('touchmove',event=>{
    if(!gesture) return;
    const touch=[...event.touches].find(touch=>touch.identifier===gesture!.id);
    if(!touch || event.touches.length!==1) {cancel();return;}
    gesture.x=touch.clientX;gesture.y=touch.clientY;
    if(!gesture.active) {if(Math.hypot(touch.clientX-gesture.startX,touch.clientY-gesture.startY)>8) cancel();return;}
    event.preventDefault();preview();
  },{passive:false});
  root.addEventListener('touchend',event=>{
    if(!gesture || ![...event.changedTouches].some(touch=>touch.identifier===gesture!.id)) return;
    const active=gesture.active;cancel();
    if(active) {event.preventDefault();suppressClick=true;options.change(new Set(options.selected()),false);}
  },{passive:false});
  root.addEventListener('touchcancel',()=>{const active=gesture?.active;cancel();if(active) options.change(new Set(options.selected()),false);});
  root.addEventListener('contextmenu',event=>{if((event.target as Element).closest('.export-tree')) event.preventDefault();});
  return {cancel,reset:()=>{cancel();anchor=null;scope=null;}};
}
