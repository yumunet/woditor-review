import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const python = fileURLToPath(
  new URL(
    process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python',
    import.meta.url,
  ),
);
if (!existsSync(python)) {
  console.error('Create .venv and install requirements-dev.txt first (see docs/development.md).');
  process.exit(1);
}
const result = spawnSync(python, ['-m', 'ruff', ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
