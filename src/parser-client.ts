import type { Diagnostic, DiagnosticDocument, ReviewFile } from './model';
let worker: Worker | undefined;
let nextId = 0;
export async function renderTranslations(files: ReviewFile[]): Promise<{path: string; text: string; version: string;csvLines?:Record<string,number>}[]> {
  worker ??= new Worker(new URL('./parser.worker.ts', import.meta.url), {type: 'module'});
  const target = worker, id = ++nextId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {target.removeEventListener('message', message); target.removeEventListener('error', error);};
    const message = ({data}: MessageEvent) => {if (data.id !== id) return; cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.result);};
    const error = (event: ErrorEvent) => {cleanup(); worker?.terminate(); worker = undefined; reject(new Error(event.message));};
    const payload = files.map(file => ({path: file.path, enText: file.enText, slots: file.slots.map(({id,line,enLine,kind,key,position,translation}) => ({id,line,enLine,kind,key,position,translation}))}));
    target.addEventListener('message', message); target.addEventListener('error', error); target.postMessage({id, files: payload});
  });
}
export function parseArchives(ja: ArrayBuffer, en: ArrayBuffer, progress: (message: string) => void, partial = false): Promise<{files: ReviewFile[]; diagnostics: Diagnostic[];diagnosticDocuments:DiagnosticDocument[]}> {
  worker ??= new Worker(new URL('./parser.worker.ts', import.meta.url), {type: 'module'});
  const target = worker, id = ++nextId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {target.removeEventListener('message', onMessage); target.removeEventListener('error', onError);};
    const onMessage = ({data}: MessageEvent) => {
      if (data.id !== id) return;
      if (data.progress) progress(data.progress);
      else {cleanup(); if (data.error) reject(new Error(data.error)); else resolve(data.result);}
    };
    const onError = (e: ErrorEvent) => {cleanup(); worker?.terminate(); worker = undefined; reject(new Error(e.message || '解析エンジンの起動に失敗しました'));};
    target.addEventListener('message', onMessage); target.addEventListener('error', onError);
    target.postMessage({id, ja, en, partial}, [ja, en]);
  });
}
