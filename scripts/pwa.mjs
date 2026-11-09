import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { resolveConfig } from 'vite';

const {base} = await resolveConfig({}, 'build', 'production', 'production');
if (!base.startsWith('/') || base.startsWith('//') || !base.endsWith('/')) throw new Error('BASE_PATH must be an absolute path ending in /');
const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
Object.assign(manifest, {id: base, start_url: base, scope: base});
manifest.icons = manifest.icons.map(icon => ({...icon, src: base + icon.src.replace(/^\//, '')}));
await writeFile('dist/manifest.webmanifest', JSON.stringify(manifest, null, 2));

// Rasterize the small app icon without an extra image dependency.
const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) {crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(body.length); crc.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([length, name, body, crc]);
};
const distance = (x,y,ax,ay,bx,by) => {
  const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
  return Math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay));
};
for (const size of [192,512]) {
  const bytes = Buffer.alloc((size * 3 + 1) * size), ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const px=x/size*192, py=y/size*192;
    let color = [26,115,232];
    if (px>=44 && px<=148 && py>=48 && py<=130 || px>=58 && px<=92 && py>=130 && py<=154-(px-58)*24/34) color=[255,255,255];
    if (Math.min(distance(px,py,70,87,87,104), distance(px,py,87,104,121,67))<5) color=[24,128,56];
    const offset=y*(size*3+1)+1+x*3;
    color.forEach((c,i)=>bytes[offset+i]=c);
  }
  await writeFile(`dist/icon-${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',deflateSync(bytes)), chunk('IEND',Buffer.alloc(0))]));
}
const files = (await readdir('dist', {recursive: true})).filter(f => /\.(html|js|css|svg|png|json|mjs|wasm|zip|webmanifest)$/.test(f) && f !== 'sw.js').map(f => f.replaceAll('\\','/')).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(`dist/${file}`));
const version = hash.digest('hex').slice(0,16);
const prefix = `woditor-review-${createHash('sha256').update(base).digest('hex').slice(0,8)}-`;
await writeFile('dist/sw.js', `
const PREFIX = ${JSON.stringify(prefix)};
const CACHE = PREFIX + '${version}';
const BASE = ${JSON.stringify(base)};
const ASSETS = ${JSON.stringify(files.map(f=>base+f))};
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX) && key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method!=='GET' || url.origin!==self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (event.request.mode==='navigate') {event.respondWith(caches.open(CACHE).then(cache=>cache.match(BASE+'index.html')).then(response=>response || fetch(event.request)));return;}
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(response=>response || fetch(event.request)));
});
`);
console.log(`PWA: ${files.length} local resources cached, version ${version}`);
