import {test,expect} from '@playwright/test';
import {mockBackend} from './mockBackend';
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),axePath=require.resolve('axe-core/axe.min.js');
const out=path.resolve('../../../docs/test-evidence/premium-visuals');
const publicRoutes=['/','/solutions','/how-it-works','/technology','/about','/get-the-app','/contact','/service-pricing','/terms','/privacy'];
const staffRoutes=['dashboard','users','farms','hardware','maintenance','reports','alerts','activity','requests','enquiries','settings','droughtCommunity','onboarding','mqttLogins'];
async function scan(page:any,name:string,width:number,theme:string) {
  await page.addScriptTag({path:axePath});
  const result=await page.evaluate(async()=>{const result=await (window as any).axe.run(document);return {
    violations:result.violations.map((v:any)=>({id:v.id,impact:v.impact,nodes:v.nodes.map((n:any)=>({target:n.target,summary:n.failureSummary}))})),
    incomplete:result.incomplete.map((v:any)=>({id:v.id,targets:v.nodes.map((n:any)=>n.target)}))};});
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,`axe-${name}-${theme}-${width}.json`),JSON.stringify(result,null,2));
  expect(result.violations.filter((v:any)=>v.id==='color-contrast'),`${name} ${theme}`).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow').toBe(true);
  await page.screenshot({path:path.join(out,`${name}-${theme}-${width}.png`),fullPage:true});
}
for(const width of [390,1366]) for(const theme of ['light','dark']) {
  test(`premium public all pages ${width} ${theme}`,async({page})=>{
    test.setTimeout(240000);await page.setViewportSize({width,height:width===390?844:768});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(theme=>localStorage.setItem('agroflow_appearance',theme),theme);
    await page.route('https://api.agroflow.test/**',route=>route.fulfill({json:[]}));
    await page.route('https://testproject.supabase.co/**',route=>route.fulfill({json:{}}));
    for(const route of publicRoutes) {
      await page.goto(route);await expect(page.locator('#publicTitle')).toBeVisible();
      if(route==='/') {
        const hero=page.locator('.visual-hero img');await expect(hero).toHaveAttribute('fetchpriority','high');
        await expect(hero).toHaveAttribute('loading','eager');
        await expect(page.locator('.premium-features img').first()).toHaveAttribute('loading','lazy');
        await expect(page.locator('.visual-hero')).toContainText('Representative image');
      }
      for(const image of await page.locator('img[src*="/images/agroflow/optimized/"]').all()) {
        await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
        expect(await image.getAttribute('src')).toMatch(/\.webp$/);
      }
      await page.evaluate(()=>scrollTo(0,0));await scan(page,route==='/'?'home':route.slice(1),width,theme);
    }
  });
  test(`premium staff all pages ${width} ${theme}`,async({page})=>{
    test.setTimeout(300000);await page.setViewportSize({width,height:width===390?844:768});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(theme=>localStorage.setItem('agroflow_appearance',theme),theme);
    await mockBackend(page,{minDelayMs:5,maxDelayMs:10});
    for(const route of staffRoutes) {
      await page.goto('/staff/#'+route);await expect(page.locator('#appShell')).toBeVisible();
      await expect(page.locator('#content')).not.toContainText('Loading…',{timeout:15000});
      await page.waitForTimeout(350);
      await scan(page,'staff-'+route,width,theme);
    }
  });
}
test('farm artwork is stable by id and independent of real farm labels',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{const module='/src/ui/agroflowImages.ts';const {farmImageKey}=await import(module);
    return {stable:['1','sesobe','farm-abcdef',0].every(id=>farmImageKey(id)===farmImageKey(id)),distinct:new Set(['1','2','3','4'].map(farmImageKey)).size};});
  expect(result.stable).toBe(true);expect(result.distinct).toBeGreaterThan(1);
});
