import { mkdir, copyFile, readdir } from 'node:fs/promises';
await mkdir('public/pyodide', { recursive: true });
for (const name of await readdir('node_modules/pyodide')) {
  if (/\.(wasm|zip|mjs|js|json)$/.test(name) && !name.startsWith('package'))
    await copyFile(`node_modules/pyodide/${name}`, `public/pyodide/${name}`);
}
