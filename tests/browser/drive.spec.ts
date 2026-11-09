import {captureUi} from './screenshots';
import {test, expect, type Page, type BrowserContext} from '@playwright/test';
import {existsSync, readFileSync} from 'node:fs';
import {zipSync, gzipSync, gunzipSync} from 'fflate';
const path = 'MapData/SampleMapA/Event_0000.txt', corpus = existsSync(`.reference/ja-JP/texts/${path}`);
const clientId = '123-test.apps.googleusercontent.com';
interface StoredFile {id:string;modifiedTime:string;appProperties:Record<string,string>;raw:Buffer}
class MockDrive {
  files:StoredFile[]=[]; sessions=new Map<string,any>(); unauthorized=false; failing=false;
  downloadGate?:Promise<void>; downloading=false;
  async route(context:BrowserContext) {
    await context.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient(config){window.requestedScopes=config.scope;return {requestAccessToken(){if(window.cancelAuth){config.error_callback({type:'popup_closed'});return;}config.callback({access_token:'test-token-in-memory',expires_in:3600,scope:config.scope});}};}}}};`}));
    await context.route('https://www.googleapis.com/**',async route=>{
      const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Expose-Headers':'Location'};
      const json=(data:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
      if(req.method()==='OPTIONS') {await route.fulfill({status:204,headers});return;}
      if(this.unauthorized){await json({},401);return;}if(this.failing){await json({},500);return;}
      expect(req.headers().authorization).toBe('Bearer test-token-in-memory');
      if(url.pathname==='/oauth2/v3/userinfo'){await json({sub:'same-google-account',email:'reviewer@example.com'});return;}
      if(url.pathname==='/drive/v3/files'&&req.method()==='GET') {
        expect(url.searchParams.get('spaces')).toBe('appDataFolder');
        await json({files:this.files.map(({raw,...metadata})=>metadata)});return;
      }
      if(url.pathname.startsWith('/drive/v3/files/')&&req.method()==='GET') {
        this.downloading=true;await this.downloadGate;
        const file=this.files.find(f=>f.id===url.pathname.split('/').at(-1));if(!file){await json({},404);return;}
        await route.fulfill({headers,contentType:'application/gzip',body:file.raw});return;
      }
      if(url.pathname==='/upload/drive/v3/files'&&req.method()==='POST') {
        const data=req.postDataJSON();expect(data.parents).toEqual(['appDataFolder']);
        const id=crypto.randomUUID();this.sessions.set(id,data);await route.fulfill({headers:{...headers,Location:`https://www.googleapis.com/mock-upload/${id}`},body:''});return;
      }
      if(url.pathname.startsWith('/mock-upload/')&&req.method()==='PUT') {
        const id=url.pathname.split('/').at(-1)!,metadata=this.sessions.get(id);this.files.push({id,modifiedTime:new Date().toISOString(),appProperties:metadata.appProperties,raw:req.postDataBuffer()!});await json({id});return;
      }
      throw Error(`Unexpected Drive request ${req.method()} ${req.url()}`);
    });
  }
  latest(){return JSON.parse(Buffer.from(gunzipSync(this.files.at(-1)!.raw)).toString('utf8'));}
}
async function loadReal(page:Page) {
  await page.goto('/');await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,lang]of [['ja','ja-JP'],['en','en-US']])await page.locator(`input[name=${name}]`).setInputFiles({name:`${lang}.zip`,mimeType:'application/zip',buffer:Buffer.from(zipSync({[`${lang}/texts/${path}`]:readFileSync(`.reference/${lang}/texts/${path}`)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});
  if(await page.getByRole('button',{name:'閉じる',exact:true}).count())await page.getByRole('button',{name:'閉じる',exact:true}).click();await openFile(page);
}
async function openFile(page:Page) {
  for(const folder of ['MapData','MapData/SampleMapA']){const row=page.locator(`.file-row[data-value="${folder}"]`);if(await row.getAttribute('aria-expanded')==='false')await row.click();}
  await page.locator(`.file-row[data-value="${path}"]`).click();
}
async function comment(page:Page,text:string) {
  await page.locator('.comment-trigger').click();await page.getByLabel('コメント内容').fill(text);await page.getByRole('button',{name:'送信',exact:true}).click();await closeSheet(page);
}
async function closeSheet(page:Page){await page.getByRole('button',{name:'閉じる',exact:true}).click();}
async function openDrive(page:Page){await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'Google Drive同期',exact:true}).click();}
async function connect(page:Page) {
  await openDrive(page);const field=page.getByLabel('Google OAuthクライアントID');
  if(!await field.inputValue()) {await field.fill(clientId);await page.getByRole('button',{name:'設定を保存',exact:true}).click();}
  await expect(page.getByRole('button',{name:'Googleに接続',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Googleに接続',exact:true}).click();await expect(page.locator('.drive-status')).toContainText('接続しました');
}
async function sync(page:Page,expected:string){await page.getByRole('button',{name:'今すぐ同期',exact:true}).click();await expect(page.locator('.drive-status')).toContainText(expected);}

test('Drive exchanges real reviews between devices, preserves conflicts, and downloads the pre-sync recovery copy',async({page,context,browser},info)=>{
  test.skip(!corpus,'Private reference files not available');const server=new MockDrive();await server.route(context);
  await loadReal(page);await comment(page,'PC original');await connect(page);
  const scopes=await page.evaluate(()=>(window as any).requestedScopes);expect(scopes).toContain('drive.appdata');expect(scopes).not.toContain('auth/drive ');
  await sync(page,'Driveに保存しました');expect(server.files).toHaveLength(1);await closeSheet(page);
  const secondContext=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:page.viewportSize()!,isMobile:info.project.name==='mobile',hasTouch:info.project.name==='mobile'});
  try {
    await server.route(secondContext);const phone=await secondContext.newPage();await phone.goto('/');await expect(phone.locator('.busy')).toHaveCount(0);await connect(phone);await sync(phone,'端末に反映しました');await closeSheet(phone);await openFile(phone);await expect(phone.locator('.float-preview')).toHaveText('PC original');
    await comment(phone,'Phone edit');await openDrive(phone);await sync(phone,'Driveに保存しました');await closeSheet(phone);
    await comment(page,'PC parallel edit');await openDrive(page);await sync(page,'異なる変更');expect(server.files).toHaveLength(2);
    await page.getByRole('button',{name:/Driveのデータを使う：/}).click();await page.getByRole('button',{name:'キャンセル',exact:true}).click();expect(server.files).toHaveLength(2);
    await captureUi(page,info,'drive-conflict');
    await page.getByRole('button',{name:/Driveのデータを使う：/}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('.drive-status')).toContainText('端末に反映しました');expect(server.files).toHaveLength(3);
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'同期前の端末データをバックアップ保存',exact:true}).click();const recovery=readFileSync((await (await event).path())!,'utf8');expect(recovery).toContain('PC parallel edit');expect(recovery).not.toContain('Phone edit');
    await closeSheet(page);await openFile(page);await expect(page.locator('.float-preview')).toHaveText('Phone edit');
    const saved=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('woditor-review');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return await new Promise<string>((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').getAll();r.onsuccess=()=>{db.close();resolve(JSON.stringify(r.result));};r.onerror=()=>reject(r.error);});});expect(saved).not.toContain('test-token-in-memory');
    const newer=server.latest(),parent=newer.id;newer.id=crypto.randomUUID();newer.parents=[parent];newer.workspace.diagnostics.push({path:'test.txt',severity:'warning',message:'Remote changed'});
    server.files.push({id:crypto.randomUUID(),modifiedTime:new Date().toISOString(),appProperties:{app:'woditor-review-sync-v1',revision:newer.id,device:'Other device',p0:parent},raw:Buffer.from(gzipSync(Buffer.from(JSON.stringify(newer))))});
    let release!:()=>void;server.downloading=false;server.downloadGate=new Promise<void>(resolve=>{release=resolve;});await openDrive(page);await page.getByRole('button',{name:'今すぐ同期',exact:true}).click();await expect.poll(()=>server.downloading).toBeTruthy();
    await closeSheet(page);await comment(page,'Local edit during download');release();await openDrive(page);await expect(page.locator('.drive-status')).toContainText('同期中に端末のデータが変わりました');await closeSheet(page);await expect(page.locator('.float-preview')).toHaveText('Local edit during download');
    await page.reload();await expect(page.locator('.busy')).toHaveCount(0);await openDrive(page);await expect(page.getByRole('button',{name:'Googleに接続',exact:true})).toBeVisible();await expect(page.getByLabel('Google OAuthクライアントID')).toHaveValue(clientId);await expect(page.getByRole('button',{name:'同期前の端末データをバックアップ保存',exact:true})).toBeVisible();
  } finally {await secondContext.close();}
});

test('Drive recovers from network failures, auto-syncs while open, and requests reconnect after expiry or popup cancellation',async({page,context})=>{
  test.skip(!corpus,'Private reference files not available');const server=new MockDrive();await server.route(context);await loadReal(page);await comment(page,'Kept locally');await page.clock.install();await connect(page);
  server.failing=true;await sync(page,'通信に失敗');expect(server.files).toHaveLength(0);server.failing=false;await sync(page,'Driveに保存しました');expect(server.files).toHaveLength(1);
  await page.getByLabel('アプリを開いている間、1分ごとに自動同期').check();await closeSheet(page);await comment(page,'Automatic edit');await page.clock.fastForward(61000);await expect.poll(()=>server.files.length).toBe(2);expect(JSON.stringify(server.latest().workspace)).toContain('Automatic edit');
  server.unauthorized=true;await openDrive(page);await sync(page,'有効期限');await expect(page.getByRole('button',{name:'Googleに接続',exact:true})).toBeVisible();server.unauthorized=false;
  await page.evaluate(()=>{(window as any).cancelAuth=true;});await page.getByRole('button',{name:'Googleに接続',exact:true}).click();await expect(page.locator('.drive-status')).toContainText('キャンセル');
  await page.evaluate(()=>{(window as any).cancelAuth=false;});await page.getByRole('button',{name:'Googleに接続',exact:true}).click();await expect(page.locator('.drive-status')).toContainText('接続しました');await sync(page,'同期済み');expect(server.files).toHaveLength(2);
  await page.getByRole('button',{name:'接続を解除',exact:true}).click();await closeSheet(page);await expect(page.locator('.float-preview')).toHaveText('Automatic edit');
});
