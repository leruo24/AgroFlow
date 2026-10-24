// Reuse the existing fake-host screenshot harness, never a live account/API.
// node scripts/web-polish-checks.mjs <export-dir> <evidence-dir> ../web/admin
import fs from 'node:fs';
const harness = new URL('./visual-redesign-screenshots.mjs', import.meta.url);
const prefix = fs.readFileSync(harness, 'utf8').split('const checks = [];')[0]
  .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(harness.href)})`)
  // The current Settings screen also reads this existing contract. Fixture only.
  .replace('function apiAnswer(method, p) {', `function apiAnswer(method, p) {
    if(p === '/api/farmer/farms/1/journey') return {
      farmId:1,setupProgress:{done:1,total:4,label:'Your details: 1 of 4',tasks:['preferences','farm','water','crops'].map(key=>({key,done:key==='preferences',doneAt:null}))},
      installation:{stage:'account_active',label:'Account active',text:'Installation: not booked yet',live:false},
      whereYouAreNow:{stage:'account_active',stageLabel:'Account active',stageNumber:4,stageCount:8,steps:[],done:[],stillToDo:[],nextAction:'Finish your details',whoActsNext:'you',whoActsNextLabel:'You',knownDate:null,dateLabel:'Whenever you are ready'},
      zones:[],helpRequests:[],terms:{accepted:{all:false,termsAcceptedAt:null,privacyAcceptedAt:null},documents:[]}};
    if(p === '/api/farmer/service') return {farmId:1,status:'demo',statusLabel:'Simulated service',payer:null,planDescription:null,
      example:{installationZar:0,monthlyZar:0,zones:3,label:'Fixture',text:'Simulated service example'},help:{inApp:'Use Help',telegram:'Simulated',staff:'Request a call'}};`);
const checks = String.raw`
const assert = (await import('node:assert/strict')).default;
const axePath = path.join(path.resolve(adminDir),'node_modules/axe-core/axe.min.js');
const results=[];
try {
for (const width of [390,1366]) {
  viewport.width=width; viewport.height=width===390?844:768;
  const login=await newPage(false);
  await login.goto(BASE+'/login');
  const call=login.getByRole('link',{name:/request.*call|ask.*call/i});
  await call.waitFor();
  await login.getByRole('progressbar').waitFor({state:'hidden',timeout:15000});
  const box=await call.boundingBox();
  assert.ok(box.height>=44,'RET-12 call request target >=44px');
  await login.addScriptTag({path:axePath});
  const axe=await login.evaluate(()=>window.axe.run(document));
  fs.writeFileSync(path.join(outDir,'axe-farmer-login-'+REVIEW_THEME+'-'+width+'.json'),JSON.stringify(axe,null,2));
  results.push({screen:'login',width,theme:REVIEW_THEME,violations:axe.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),callTargetHeight:box.height});
  await login.screenshot({path:path.join(outDir,'farmer-login-'+REVIEW_THEME+'-'+width+'.png'),fullPage:true});
  await login.context().close();
  const page=await newPage(true);
  await page.goto(BASE+'/settings');
  const english=page.getByTestId('language-en'); await english.waitFor();
  assert.equal(await english.getAttribute('aria-checked'),'true');
  await page.waitForTimeout(1800);
  await english.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  assert.equal(await page.getByTestId('language-af').getAttribute('aria-checked'),'true');
  assert.equal(await page.getByTestId('language-en').getAttribute('aria-checked'),'false');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await english.getAttribute('aria-checked'),'true');
  for (const group of await page.getByRole('radiogroup').all()) {
    assert.ok((await group.getAttribute('aria-label')) || (await group.getAttribute('aria-labelledby')),'named group');
    for (const radio of await group.getByRole('radio').all()) assert.ok(['true','false'].includes(await radio.getAttribute('aria-checked')));
  }
  await page.screenshot({path:path.join(outDir,'farmer-settings-'+REVIEW_THEME+'-'+width+'.png'),fullPage:true});
  for(const [name,url] of [['home','/'],['zone','/zone/3'],['wizard','/setup?step=location']]) {
    await page.goto(BASE+url); await page.waitForTimeout(1800);
    await page.screenshot({path:path.join(outDir,'farmer-'+name+'-'+REVIEW_THEME+'-'+width+'.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow');
  }
  // The no-kit zone exposes the existing soil-feel action; opening it never saves.
  await page.goto(BASE+'/'); await page.waitForTimeout(1800);
  const trigger=page.getByRole('button',{name:/how does.*soil feel|check.*soil|soil feel/i}).first();
  if(await trigger.count()) {
    await trigger.focus(); await trigger.click();
    const dialog=page.getByRole('dialog').last(); await dialog.waitFor();
    assert.ok(await dialog.getAttribute('aria-labelledby'),'soil-feel named by heading');
    await page.waitForTimeout(100);
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'focus enters dialog');
    for(let i=0;i<15;i++) {await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'Tab trapped');}
    await page.screenshot({path:path.join(outDir,'soil-feel-'+REVIEW_THEME+'-'+width+'.png'),fullPage:true});
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    assert.ok(await trigger.evaluate(el=>el===document.activeElement),'focus restored');
    results.push({screen:'soil-feel',width,focus:'enter/trap/Escape/return passed'});
  } else throw new Error('Existing soil-feel trigger not found; do not silently skip');
  results.push({screen:'settings',width,radioKeys:'ArrowRight/Left, checked state and group names passed'});
  await page.context().close();
}
fs.writeFileSync(path.join(outDir,'farmer-checks-'+REVIEW_THEME+'.json'),JSON.stringify({results,pageErrors:errors},null,2));
console.log(JSON.stringify({results,pageErrors:errors},null,2));
assert.deepEqual(errors,[]);
assert.ok(results.filter(r=>r.screen==='login').every(r=>r.violations.length===0),'login axe violations');
} finally { console.log('page errors',errors); await browser.close(); server.close(); }
`;
try { await import('data:text/javascript;base64,' + Buffer.from(prefix + checks).toString('base64')); }
catch(error) { console.error(error.message); process.exitCode=1; }
