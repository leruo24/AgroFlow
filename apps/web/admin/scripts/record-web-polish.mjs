// Local fake-host Vite server only. No live service requests are permitted.
// WEB_POLISH_BASE=http://localhost:5187 node scripts/record-web-polish.mjs
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const out=path.resolve('../../../docs/test-evidence/web-polish-oct23');
const base=process.env.WEB_POLISH_BASE??'http://localhost:5187';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local evidence only');
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
try {
  for(const width of [390,1366]) for(const theme of ['light','dark']) {
    const viewport={width,height:width===390?844:768};
    const context=await browser.newContext({viewport,reducedMotion:'reduce',recordVideo:{dir:out,size:viewport}});
    await context.addInitScript(theme=>localStorage.setItem('agroflow_appearance',theme),theme);
    await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    const page=await context.newPage();
    await page.goto(base+'/technology');
    const viewer=page.locator('[data-hardware-viewer]'); await viewer.scrollIntoViewIfNeeded();
    await page.locator('[data-hardware-viewer].is-ready').waitFor();
    // Keyboard-only operation: all activation is focus + Enter, never a mouse click.
    const activate=async(selector)=>{await page.locator(selector).focus(); await page.keyboard.press('Enter');};
    await activate('[data-hardware-reset]');
    for(let angle=0;angle<6;angle++) {
      await activate('[data-hardware-toggle]');
      for(let i=0;i<5;i++)await activate('[data-hardware-rotate="right"]');
      await activate('[data-hardware-close]');
    }
    await activate('[data-hardware-toggle]');
    await activate('[data-hardware-scene="drip-irrigation"]');
    await activate('[data-hardware-scene="open-field"]');
    await viewer.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`viewer-open-${theme}-${width}.png`)});
    const angle=await viewer.getAttribute('data-rotation');
    await page.setViewportSize({width:width===390?430:1100,height:viewport.height});
    await page.waitForTimeout(200);
    if(await viewer.getAttribute('data-rotation')!==angle)throw new Error('Resize reset user angle');
    const size=await viewer.getAttribute('data-canvas-size');
    await page.locator('[data-hardware-stage="3"]').scrollIntoViewIfNeeded();
    if(await viewer.getAttribute('data-canvas-size')!==size)throw new Error('Scroll resized canvas');
    await page.setViewportSize(viewport);
    await activate('[data-hardware-demo]');
    await page.screenshot({path:path.join(out,`demo-reduced-${theme}-${width}.png`)});
    const reduced=await page.locator('.demo-drops').evaluate(el=>getComputedStyle(el).animationName);
    if(reduced!=='none')throw new Error('Reduced-motion flow animation');
    await activate('[data-hardware-demo-stop]'); await activate('[data-hardware-demo-reset]');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await activate('[data-hardware-demo]'); await page.waitForTimeout(700);
    await activate('[data-hardware-demo-stop]');
    for(const [name,url] of [['homepage','/'],['about','/about']]) {
      await page.goto(base+url); await page.screenshot({path:path.join(out,`${name}-${theme}-${width}.png`),fullPage:true});
    }
    results.push({width,theme,keyboard:'full turn, six door swings, scenes and isolated demo',resize:'angle preserved; scroll size stable',motion:'reduced and normal'});
    const video=page.video(); await context.close();
    fs.renameSync(await video.path(),path.join(out,`viewer-${theme}-${width}.webm`));
  }
  fs.writeFileSync(path.join(out,'viewer-checks.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
