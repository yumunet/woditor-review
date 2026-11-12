import { readFileSync } from 'node:fs';

interface Pair {
  path: string;
  ja: string[];
  en: string[];
}
export const fixtures: Record<string, Pair> = JSON.parse(
  readFileSync(new URL('../fixtures/woditor.json', import.meta.url), 'utf8'),
);
export const fixtureText = (name: string, language: 'ja' | 'en') =>
  fixtures[name][language].join('\n') + '\n';

export const sourcePath = fixtures.map.path;
export const navigationPaths = [
  'BasicData/CommonEvent/000.txt',
  'BasicData/CommonEvent/001.txt',
  'BasicData/CommonEvent/002.txt',
  'MapData/Dungeon/Event_0000.txt',
];
export function fixtureTextAt(path: string, language: 'ja' | 'en') {
  const name = Object.keys(fixtures).find((name) => fixtures[name].path === path);
  if (name) return fixtureText(name, language);
  if (path.startsWith('BasicData/CommonEvent/'))
    return fixtureText('common', language).replace(
      'COMMON_ID=0',
      `COMMON_ID=${Number(path.split('/').at(-1)!.replace('.txt', ''))}`,
    );
  if (path.startsWith('MapData/')) return fixtureText('map', language);
  throw new Error(`Unknown test fixture: ${path}`);
}
