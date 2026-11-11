import type {ReviewFile,Slot} from './model';
export const isDatabaseMemo=(file:Pick<ReviewFile,'type'>|undefined,slot:Slot)=>file?.type==='database'&&slot.key==='MEMO';
export function displaySlotText(file:Pick<ReviewFile,'type'>,slot:Slot,text:string):string {
  return isDatabaseMemo(file,slot)?text.split(String.raw`<<\n>>`).join('\n'):text;
}
