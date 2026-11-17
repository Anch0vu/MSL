const fs = require('node:fs');
const assert = require('node:assert/strict');
const puppeteer = require('/tmp/cup-obs-qa/node_modules/puppeteer-core');
const BASE = process.env.OBS_TEST_BASE || 'http://127.0.0.1:13782';
const db = JSON.parse(fs.readFileSync('/tmp/cup-obs-qa/db.json'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const media = new Map();
(async () => {
 const browser = await puppeteer.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-155.0.8059.84/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--window-size=1920,1080']});
 let failures=0;
 async function fixture(width=1440, access=true, hasKey=true) {
  const page=await browser.newPage(); page.setDefaultTimeout(8000); await page.setBypassServiceWorker(true); await page.setViewport({width,height:1000});
  let state={rev:1,at:'initial',series:{a:0,b:0},casters:[],ticker:{on:false,items:[]}};
  let hold=false, release=()=>{}, failData=false, fixtureDB=structuredClone(db);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(hasKey=>{localStorage.clear();if(hasKey)sessionStorage.setItem('cup:obs-scene-key-v2','fixture-only-not-a-real-key');else sessionStorage.removeItem('cup:obs-scene-key-v2')},hasKey);
  await page.setRequestInterception(true);
  page.on('request',async req=>{
   const u=new URL(req.url());
   if(u.pathname.includes('/api')) {
    const r=u.searchParams.get('r');let data={};
    if(r==='teammedia'||r==='avatar'){
      const url='https://cup.rut-miit.su/api/'+u.search;
      if(!media.has(url))media.set(url,fetch(url).then(async response=>({status:response.status,contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer())})));
      return req.respond(await media.get(url));
    }
    if(r==='db'&&failData)return req.respond({status:503,body:'offline'});
    if(r==='db') data=fixtureDB;
    if(r==='account') data={user:null};
    if(r==='me') data={admin:true,role:'admin'};
    if(r==='obsauth'||r==='obsaccess') data={authorized:access};
    if(r==='obskeys') data={keys:[],canManageAll:true};
    if(r==='obsheroes'||r==='partners') data=[];
    if(r==='obs') data={state,can:true,now:Date.now()};
    if(r==='obsset') {const p=JSON.parse(req.postData());state={...state,...p.patch,rev:state.rev+1,at:String(Date.now())};data={state};}
    const body=JSON.stringify(data); if(r==='obs' && hold){hold=false;await new Promise(resolve=>release=resolve)}
    return req.respond({status:200,contentType:'application/json',body});
   }
   if(u.pathname.endsWith('/data/db.json')&&failData)return req.respond({status:503,body:'offline'});
   if(u.origin!==new URL(BASE).origin) return req.abort();
   return req.continue();
  });
  return {page,errors,db:fixtureDB,failData:(value)=>failData=value,holdNext:()=>hold=true,release:()=>release(),bump:(patch={})=>{state={...state,...patch,rev:state.rev+1,at:String(Date.now())}}};
 }
 async function test(name,fn){try{await fn();console.log('PASS '+name)}catch(e){failures++;console.log('FAIL '+name+': '+e.message)}finally{for(const page of await browser.pages())if(page.url()!=='about:blank')await page.close()}}
 try {
 if(!process.env.OBS_PRODUCTION) await test('unchanged published data preserves consumer render',async()=>{
  const {page}=await fixture();await page.goto(BASE+'/tests/obs-data.html');await page.waitForSelector('output');
  const before=await page.$eval('output',e=>e.textContent);
  await page.click('button');await wait(300);await page.click('button');await wait(300);
  assert.equal(await page.$eval('output',e=>e.textContent),before);await page.close();
 });
 await test('studio draft survives another operator update',async()=>{
  const {page,bump,errors}=await fixture();await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  await page.evaluate(()=>[...document.querySelectorAll('.ocp-tabs button')].find(b=>b.textContent==='Студия').click());
  await page.type('input[placeholder="Имя 1"]','Черновик оператора');bump();await wait(1900);
  assert.equal(await page.$eval('input[placeholder="Имя 1"]',e=>e.value),'Черновик оператора');assert.deepEqual(errors,[]);await page.close();
 });
 await test('normal scene links follow console timer and casters',async()=>{
  const {page}=await fixture();await page.goto(BASE+'/#/obs');await page.waitForSelector('.obs-item');
  const links=await page.$$eval('.obs-item a',els=>els.map(e=>e.href));
  const starting=links.find(x=>x.includes('/starting?'));assert.ok(starting,'starting link');
  assert.ok(!starting.includes('min='),'starting URL overrides console countdown');
  const casters=links.find(x=>x.includes('/casters?'));assert.ok(!casters.includes('cams=')&&!casters.includes('c1='),'casters URL overrides console names');
  assert.ok(!starting.includes('t='),'default URL pins tournament instead of following chosen match');await page.close();
 });
 await test('preview fits narrow console without clipping',async()=>{
  const {page}=await fixture(540);await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Показать превью').click());await page.waitForSelector('.ocp-prev iframe');
  const sizes=await page.evaluate(()=>({box:document.querySelector('.ocp-prev').getBoundingClientRect().width,frame:document.querySelector('.ocp-prev iframe').getBoundingClientRect().width}));
  assert.ok(Math.abs(sizes.box-sizes.frame)<4,JSON.stringify(sizes));await page.close();
 });
 await test('friendly scene selector and explicit FPS switch',async()=>{
  const {page}=await fixture();await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  assert.ok(await page.$('input[aria-label="Замер FPS в предпросмотре"]'),'FPS option missing');
  const labels=await page.$$eval('.ocp-preview select option',els=>els.map(e=>e.textContent));assert.ok(labels.some(x=>x.includes('Счёт поверх игры')));await page.close();
 });
 if(!process.env.OBS_PRODUCTION) await test('stale in-flight poll cannot roll back a saved score',async()=>{
  const {page,holdNext,release}=await fixture();await page.goto(BASE+'/tests/obs-state.html');await page.waitForFunction(()=>document.querySelector('output')?.textContent==='0');
  holdNext();await page.click('#reload');await wait(100);await page.click('#patch');await wait(200);release();await wait(300);
  assert.equal(await page.$eval('output',e=>e.textContent),'1');await page.close();
 });
 if(!process.env.OBS_PRODUCTION) await test('temporary data outage keeps the last scene mounted',async()=>{
  const {page,failData}=await fixture();await page.goto(BASE+'/tests/obs-data.html');await page.waitForSelector('output');
  failData(true);await page.click('button');await wait(400);assert.ok(await page.$('output'),'last good screen was replaced by boot error');
  failData(false);await page.click('button');await wait(200);assert.ok(await page.$('output'));await page.close();
 });
 await test('clean studio fields follow another operator update',async()=>{
  const {page,bump}=await fixture();await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  await page.evaluate(()=>[...document.querySelectorAll('.ocp-tabs button')].find(b=>b.textContent==='Студия').click());
  bump({casters:[{name:'Другой оператор',role:'Комментатор'}]});await wait(1900);
  assert.equal(await page.$eval('input[placeholder="Имя 1"]',e=>e.value),'Другой оператор');await page.close();
 });
 await test('preview debug options never enter copied OBS URL',async()=>{
  const {page}=await fixture();await browser.defaultBrowserContext().overridePermissions(BASE,['clipboard-read','clipboard-write']);
  await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-preview');
  await page.click('.ocp-preview input[type=checkbox]');await page.click('input[aria-label="Замер FPS в предпросмотре"]');
  await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text}});
  await page.click('.ocp-preview > button');await wait(150);
  const text=await page.evaluate(()=>window.__copied);assert.ok(text.includes('obskey='));assert.ok(!text.includes('demo=')&&!text.includes('perf='));await page.close();
 });
 await test('unconnected OBS has disabled preview and source copy',async()=>{
  const {page}=await fixture(390,true,false);await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-preview');
  assert.ok(await page.$eval('.ocp-preview button',e=>e.disabled));
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false);await page.close();
 });
 await test('denied scene does not render graphics',async()=>{
  const {page}=await fixture(1920,false);await page.goto(BASE+'/#/obs/hud?obskey=invalid');await page.waitForFunction(()=>document.body.textContent.includes('Доступ ограничен'));
  assert.equal(await page.$('.obs-stage'),null);await page.close();
 });
 await test('dirty caster name does not overwrite a clean remote caster',async()=>{
  const {page,bump}=await fixture();await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  await page.evaluate(()=>[...document.querySelectorAll('.ocp-tabs button')].find(b=>b.textContent==='Студия').click());
  await page.type('input[placeholder="Имя 1"]','Локальное имя');
  bump({casters:[{name:'',role:'Новая роль'},{name:'Удалённый комментатор',role:'Аналитик'}]});await wait(1900);
  assert.equal(await page.$eval('input[placeholder="Имя 1"]',e=>e.value),'Локальное имя');
  assert.equal(await page.$eval('input[placeholder="Имя 2"]',e=>e.value),'Удалённый комментатор');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить состав').click());await wait(300);
  assert.equal(await page.$eval('input[placeholder="Имя 2"]',e=>e.value),'Удалённый комментатор');await page.close();
 });
 await test('explicit break reset clears dirty local text',async()=>{
  const {page,bump}=await fixture();bump({brk:{title:'Published'}});await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-tabs');
  await page.evaluate(()=>[...document.querySelectorAll('.ocp-tabs button')].find(b=>b.textContent==='Перерыв').click());
  const selector='input[placeholder="Заголовок (например «Скоро начнём»)"]';await page.type(selector,' unsaved');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Сбросить всё').click());await wait(300);
  assert.equal(await page.$eval(selector,e=>e.value),'');await page.close();
 });
 await test('bracket scene renders the published group stage',async()=>{
  const {page,errors}=await fixture(1920);await page.goto(BASE+'/#/obs/bracket?obskey=fixture');await page.waitForSelector('.obs-stage');await wait(200);
  const groups=await page.$$eval('.obs-group-board .group',els=>els.map(e=>e.textContent));assert.equal(groups.length,4,'four published groups must be visible');assert.ok(groups[0].includes('Группа A'));assert.deepEqual(errors,[]);
  if(process.env.OBS_SCREENSHOT){await page.setViewport({width:1920,height:1080});await page.screenshot({path:'/tmp/cup-obs-qa/groups.jpg',type:'jpeg',quality:75})}await page.close();
 });
 await test('bracket scene shows an explicit empty state',async()=>{
  const {page,db:doc}=await fixture(1920);doc.db.tournaments.forEach(t=>t.stages=[]);await page.goto(BASE+'/#/obs/bracket?obskey=fixture');await page.waitForSelector('.obs-stage');await wait(100);
  assert.ok(await page.$('.obs-bracket-empty'),'empty tournament must not produce a blank canvas');await page.close();
 });
 await test('knockout demo bracket remains visible and fitted',async()=>{
  const {page,errors}=await fixture(1920);await page.goto(BASE+'/#/obs/bracket?obskey=fixture&demo=1');await page.waitForSelector('.uc-bracket');
  const box=await page.$eval('.uc-bracket',e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y}});assert.ok(box.width>500&&box.height>100,JSON.stringify(box));assert.deepEqual(errors,[]);await page.close();
 });
 if(process.env.OBS_SCREENSHOT){
  const {page}=await fixture(1440);await page.goto(BASE+'/#/obs');await page.waitForSelector('.ocp-preview');
  await page.click('.ocp-preview input[type=checkbox]');await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Показать превью').click());await wait(500);
  await (await page.$('.ocp')).screenshot({path:'/tmp/cup-obs-qa/console.png'});
  await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/cup-obs-qa/mobile.png',fullPage:true});await page.close();
 }
 if(process.env.OBS_PERF) {
  for(const scene of ['intro','veto','draft','hud','stinger','starting']) {
   const {page,errors}=await fixture(1920);await page.setViewport({width:1920,height:1080});await page.goto(BASE+'/#/obs/'+scene+'?demo=1&obskey=fixture&perf=1');await page.waitForSelector('.obs-stage');
   const timing=await page.evaluate(()=>new Promise(resolve=>{let frames=0,slow=0,worst=0,start=performance.now(),prev=start;function frame(now){let gap=now-prev;prev=now;frames++;if(gap>25)slow++;worst=Math.max(worst,gap);if(now-start>8000)resolve({fps:Math.round(frames*1000/(now-start)),slow,worst:Math.round(worst)});else requestAnimationFrame(frame)}requestAnimationFrame(frame)}));
   console.log('PERF '+scene+' '+JSON.stringify({...timing,errors}));await page.close();
  }
 }
 }finally{await browser.close()}
 process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exit(1)});
