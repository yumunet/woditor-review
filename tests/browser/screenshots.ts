import type {Page, TestInfo} from '@playwright/test';
import {mkdirSync} from 'node:fs';

// Opt in to individual changed screens, e.g. UPDATE_SCREENSHOTS=review,items.
export async function captureUi(page:Page, info:TestInfo, name:string) {
  if (!process.env.UPDATE_SCREENSHOTS?.split(',').includes(name)) return;
  mkdirSync('docs/screenshots',{recursive:true});
  await page.screenshot({path:`docs/screenshots/${info.project.name}-${name}.png`});
}
