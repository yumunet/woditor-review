import type {ReviewFile,Slot} from './model';
export const isDatabaseMemo=(file:Pick<ReviewFile,'type'>|undefined,slot:Slot)=>file?.type==='database'&&slot.key==='MEMO';
export function displaySlotText(file:Pick<ReviewFile,'type'>,slot:Slot,text:string):string {
  if(slot.command) return (slot.command.code!==103?text.split(String.raw`<\n>`).join('\n'):text).split('<dqrt>').join('"');
  return isDatabaseMemo(file,slot)?text.split(String.raw`<<\n>>`).join('\n'):text;
}
