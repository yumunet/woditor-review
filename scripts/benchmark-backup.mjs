// Windows/Edge benchmark. Generated data only; no application storage is read.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { release } from 'node:os';

if (process.platform !== 'win32') throw new Error('Process memory sampling requires Windows.');
const destination = process.argv[2] ?? '.tools/quality-audit/backup-memory.json';
const server = await createServer({ server: { host: '127.0.0.1', port: 4175, strictPort: true } });
// A persistent sampler avoids starting PowerShell for each 25ms measurement.
const sampler = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `
  while ($null -ne ($line = [Console]::ReadLine())) {
    $private = 0L; $resident = 0L
    foreach ($processId in ($line -split ',')) {
      $p = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
      if ($null -ne $p) { $private += $p.PrivateMemorySize64; $resident += $p.WorkingSet64 }
    }
    [Console]::WriteLine(('{"private":' + $private + ',"resident":' + $resident + '}'))
  }
`,
  ],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] },
);
const replies = [];
createInterface({ input: sampler.stdout }).on('line', (line) =>
  replies.shift()?.(JSON.parse(line)),
);
const sample = async (cdp) => {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return new Promise((resolve) => {
    replies.push(resolve);
    sampler.stdin.write(processInfo.map((p) => p.id).join(',') + '\n');
  });
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const settled = [];
let browser, browserVersion;
try {
  await server.listen();
  for (const mode of process.argv[3] ? [process.argv[3]] : ['legacy', 'streaming']) {
    if (!['legacy', 'streaming'].includes(mode)) throw new Error('Unknown benchmark mode');
    console.log(`Preparing ${mode}`);
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
      args: ['--enable-precise-memory-info'],
    });
    browserVersion = browser.version();
    const browserCDP = await browser.newBrowserCDPSession();
    const page = await browser.newPage();
    const mainCDP = await page.context().newCDPSession(page);
    let workers = 0;
    page.on('worker', (worker) => {
      workers++;
      worker.on('close', () => workers--);
    });
    await page.goto('http://127.0.0.1:4175/icon.svg');
    console.log('Generating workspace');
    await page.evaluate(async () => {
      const { emptyWorkspace } = await import('/src/model.ts');
      const { validateWorkspace } = await import('/src/storage.ts');
      const { createBackup } = await import('/src/backup-archive.ts');
      const state = emptyWorkspace();
      let seed = 42;
      const text = (japanese) => {
        let value = '';
        for (let i = 0; i < 256; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          value += String.fromCharCode((japanese ? 0x3041 : 65) + (seed % (japanese ? 80 : 26)));
        }
        return value + '\n"\\😀';
      };
      for (let f = 0; f < 160; f++) {
        const slots = [],
          items = [];
        let jaText = '',
          enText = '';
        for (let s = 0; s < 64; s++) {
          const source = text(true),
            translation = text(false),
            id = `S${s}`;
          slots.push({
            id,
            source,
            translation,
            key: id,
            kind: 'metadata',
            title: id,
            fingerprint: 'a'.repeat(64),
            line: s + 1,
            start: jaText.length,
            end: jaText.length + source.length,
            command: null,
            warnings: [],
          });
          jaText += source + '\n';
          enText += translation + '\n';
          items.push({
            id,
            slotIds: [id],
            title: id,
            code: null,
            depth: null,
            lastLine: s + 1,
            approved: false,
            threads: [],
            changes: [],
          });
        }
        state.files.push({
          path: `MapData/Generated/Event_${f}.txt`,
          type: 'map',
          jaText,
          enText,
          jaBom: false,
          enBom: false,
          sourceVersion: 'a'.repeat(64),
          version: 'b'.repeat(64),
          slots,
          items,
          commands: [],
          excluded: [],
          warnings: [],
          usages: {},
        });
      }
      validateWorkspace(state);
      // Warm module loading/worker compilation before the timed runs.
      await createBackup(emptyWorkspace());
      Object.assign(globalThis, {
        benchmarkState: state,
        benchmarkBackup: createBackup,
        urls: new Set(),
      });
    });
    console.log('Workspace ready');
    await mainCDP.send('HeapProfiler.collectGarbage');
    await delay(2000);
    await mainCDP.send('HeapProfiler.collectGarbage');
    await delay(1000);
    for (let run = 1; run <= 3; run++) {
      const baseline = await sample(browserCDP);
      let peakPrivate = baseline.private,
        peakResident = baseline.resident,
        peakMainHeap = 0,
        stop = false;
      const heapPolling = (async () => {
        while (!stop) {
          const memory = await mainCDP.send('Runtime.getHeapUsage');
          peakMainHeap = Math.max(peakMainHeap, memory.usedSize + memory.backingStorageSize);
          await delay(25);
        }
      })();
      const polling = (async () => {
        while (!stop) {
          const memory = await sample(browserCDP);
          peakPrivate = Math.max(peakPrivate, memory.private);
          peakResident = Math.max(peakResident, memory.resident);
          await delay(25);
        }
      })();
      const output = await page.evaluate(async (mode) => {
        const start = performance.now();
        // Exact pre-ZIP implementation: indented JSON passed directly to Blob.
        let blob;
        if (mode === 'legacy') {
          const text = JSON.stringify(globalThis.benchmarkState, null, 2);
          blob = new globalThis.Blob([text], { type: 'application/json' });
        } else blob = (await globalThis.benchmarkBackup(globalThis.benchmarkState)).blob;
        const elapsed = performance.now() - start,
          bytes = blob.size;
        const url = globalThis.URL.createObjectURL(blob);
        globalThis.urls.add(url);
        globalThis.setTimeout(
          () => {
            globalThis.URL.revokeObjectURL(url);
            globalThis.urls.delete(url);
          },
          mode === 'legacy' ? 30000 : 1000,
        );
        return { elapsed, bytes };
      }, mode);
      // Capture the native Blob too, including when the main JS task was synchronous.
      stop = true;
      await polling;
      await heapPolling;
      const held = await sample(browserCDP);
      peakPrivate = Math.max(peakPrivate, held.private);
      peakResident = Math.max(peakResident, held.resident);
      await page.waitForFunction(() => globalThis.urls.size === 0, null, { timeout: 35000 });
      await mainCDP.send('HeapProfiler.collectGarbage');
      await delay(250);
      const retained = await sample(browserCDP);
      const heap = await mainCDP.send('Runtime.getHeapUsage');
      const result = {
        mode,
        run,
        ...output,
        baseline,
        peakPrivate,
        peakResident,
        peakMainHeap,
        retained,
        mainHeap: heap.usedSize,
        mainBacking: heap.backingStorageSize,
        workers,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    // Compare a common idle period too; Chromium may keep reusable native allocations.
    if (mode === 'streaming') await delay(30000);
    await mainCDP.send('HeapProfiler.collectGarbage');
    await delay(250);
    settled.push({
      mode,
      memory: await sample(browserCDP),
      heap: await mainCDP.send('Runtime.getHeapUsage'),
      workers,
    });
    await browser.close();
    browser = undefined;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    JSON.stringify(
      {
        environment: {
          platform: process.platform,
          os: release(),
          node: process.version,
          browserVersion,
        },
        data: { files: 160, slots: 10240, seed: 42 },
        results,
        settled,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser?.close();
  sampler.stdin.end();
  await server.close();
}
