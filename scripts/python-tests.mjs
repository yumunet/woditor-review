import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const local = '.tools/python';
const installed = existsSync(local) ? readdirSync(local).map(p => join(local, p, 'python.exe')).find(existsSync) : null;
const command = process.env.PYTHON || installed || (process.platform === 'win32' ? 'py' : 'python3');
const r = spawnSync(command, ['-m', 'unittest', 'discover', '-s', 'tests/python', '-v'], { stdio: 'inherit', env: { ...process.env, PYTHONPATH: 'python', PYTHONUTF8: '1' } });
process.exit(r.status ?? 1);
