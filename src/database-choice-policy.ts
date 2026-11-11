export function databaseChoiceMode(header:string,field:number):number {
  const value=new RegExp(`^ITEM_LOADTYPE_${field}=([^\\r\\n]*)`,'m').exec(header)?.[1];
  if(value===undefined || !/^\d+$/.test(value)) return 0;
  const mode=Number(value);return mode===1 || mode===2 || mode===3?mode:0;
}

export function databaseChoicesEnabled(header:string,field:number):boolean {
  const mode=databaseChoiceMode(header,field);return mode===2 || mode===3;
}
