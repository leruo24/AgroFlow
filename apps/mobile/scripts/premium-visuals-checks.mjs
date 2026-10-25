// Uses the existing intercepted Mahikeng fixture, not live accounts or save paths.
// node scripts/premium-visuals-checks.mjs <web-export> <evidence> ../web/admin
import fs from 'node:fs';
const existing=new URL('./web-polish-checks.mjs',import.meta.url);
// Reuse its fixture construction before the old check loop, resolving the file
// URL before evaluating the module (data URLs cannot resolve relative resources).
const builder=fs.readFileSync(existing,'utf8').split('const checks = String.raw`')[0]
  .replace('import.meta.url',JSON.stringify(existing.href));
const checks=String.raw`
const assert=(await import('node:assert/strict')).default;
const axePath=path.join(path.resolve(adminDir),'node_modules/axe-core/axe.min.js');
const results=[];
try {
  for(const width of [390,1366]) {
    viewport.width=width;viewport.height=width===390?844:768;
    for(const signedIn of [false,true]) {
      const page=await newPage(signedIn);
      // Only test fixtures: a representative linked kit and real contract fields.
      if(signedIn)await page.route(FAKE_API+'/api/farmer/farms/1/kits',route=>route.fulfill({json:[{zoneId:1,zoneName:'Maize',hasKit:true,deviceId:'fixture-kit',deviceName:'Simulated kit',setupNetworkName:null,setupNetworkPassword:null,overall:'needs_attention',lines:[{key:'wifi',label:'Wi-Fi',state:'ok',text:'Connected',detail:null}]}]}));
      const routes=signedIn?['/','/irrigation','/kit','/alerts','/more','/settings','/history','/zone/1','/zone/3','/tank','/forecast','/reports','/community','/profile','/setup','/legal?doc=terms']:['/login','/enquiry','/forgot-password'];
      for(const route of routes) {
        await page.goto(BASE+route);await page.waitForTimeout(1800);
        await page.getByRole('progressbar',{name:/starting/i}).waitFor({state:'hidden',timeout:15000}).catch(()=>{});
        await page.addScriptTag({path:axePath});
        const result=await page.evaluate(async()=>{const result=await window.axe.run(document);return {violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))};});
        const name=route==='/'?'home':route.slice(1).replaceAll('/','-').replace('?doc=','-');
        fs.writeFileSync(path.join(outDir,'axe-farmer-'+name+'-'+REVIEW_THEME+'-'+width+'.json'),JSON.stringify(result,null,2));
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        await page.screenshot({path:path.join(outDir,'farmer-'+name+'-'+REVIEW_THEME+'-'+width+'.png'),fullPage:true});
        results.push({route,width,theme:REVIEW_THEME,overflow,contrast:result.violations.filter(v=>v.id==='color-contrast'),imageAlt:result.violations.filter(v=>v.id==='image-alt')});
        if(route==='/') {
          const tabs=page.getByRole('tab');const names=await tabs.allTextContents();
          assert.ok(['Home','Irrigation','Kit','Alerts','More'].every(label=>names.some(name=>name.includes(label))),'unchanged five tabs');
        }
      }
      await page.context().close();
    }
  }
  fs.writeFileSync(path.join(outDir,'farmer-summary-'+REVIEW_THEME+'.json'),JSON.stringify({results,pageErrors:errors},null,2));
  console.log(JSON.stringify({checks:results.length,contrastFailures:results.filter(r=>r.contrast.length).map(r=>({route:r.route,width:r.width,nodes:r.contrast})),overflow:results.filter(r=>r.overflow),pageErrors:errors},null,2));
  assert.deepEqual(errors,[]);assert.ok(results.every(r=>!r.overflow&&!r.contrast.length&&!r.imageAlt.length));
} finally {await browser.close();server.close();}
`;
const run=builder+'\nconst checks='+JSON.stringify(checks)+';\nawait import("data:text/javascript;base64,"+Buffer.from(prefix+checks).toString("base64"));';
try {await import('data:text/javascript;base64,'+Buffer.from(run).toString('base64'));}catch(error){console.error(error.message);process.exitCode=1;}
