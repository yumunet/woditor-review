import {matches,type Filter,type Item,type ReviewFile} from './model';
import {fileTree,type TreeNode} from './ui';

export interface NavigationTarget {file:ReviewFile;item:Item;filter:Filter;crossesFile:boolean;direction:-1|1}
export function orderedReviewFiles(files:ReviewFile[]):ReviewFile[] {
  const visit=(node:TreeNode):ReviewFile[]=>node.file?[node.file]:node.children.flatMap(visit);
  return visit(fileTree(files,'all'));
}
export function navigationTarget(files:ReviewFile[],path:string,currentId:string|null,itemFilter:Filter,folderFilter:Filter,direction:-1|1):NavigationTarget|undefined {
  const file=files.find(f=>f.path===path),index=file?.items.findIndex(i=>i.id===currentId)??-1;
  if(!file || index<0) return undefined;
  for(let n=index+direction;n>=0 && n<file.items.length;n+=direction) {
    if(matches(file.items[n],itemFilter)) return {file,item:file.items[n],filter:itemFilter,crossesFile:false,direction};
  }
  // Use the complete tree for the current file's position, even if the current
  // item has just made that file disappear from the folder filter.
  const ordered=orderedReviewFiles(files),position=ordered.findIndex(f=>f.path===path);
  for(let n=position+direction;n>=0 && n<ordered.length;n+=direction) {
    const destination=ordered[n],items=destination.items.filter(i=>matches(i,folderFilter));
    const item=direction>0?items[0]:items.at(-1);
    if(item) return {file:destination,item,filter:folderFilter,crossesFile:true,direction};
  }
  return undefined;
}
export function navigationQuestion(currentPath:string,target:NavigationTarget):string {
  const direction=target.direction>0?'次':'前';
  const folder=(path:string)=>path.split('/').slice(0,-1).join('/');
  const name=target.file.path.split('/').at(-1)!;
  if(folder(currentPath)!==folder(target.file.path)) return `${direction}のフォルダ「${folder(target.file.path)||'ルート'}」へ移動して「${name}」を開きますか？`;
  return `${direction}の「${name}」を開きますか？`;
}
