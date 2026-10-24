import { test, expect } from '@playwright/test';
import { mockBackend } from './mockBackend';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const evidence = path.resolve('../../../docs/test-evidence/web-polish-oct23');
test.describe.configure({ mode: 'parallel' });

for (const width of [390,1366]) for (const theme of ['light','dark']) {
  test(`RET-03/04/05/11/13 public and viewer ${width} ${theme}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 768 });
    await page.addInitScript(theme => localStorage.setItem('agroflow_appearance',theme),theme);
    await page.emulateMedia({ reducedMotion:'reduce' });
    for(const route of ['/','/get-the-app']) {
      await page.goto(route);
      const links=page.getByRole('link',{name:/open farmer app/i});
      expect(await links.count()).toBeGreaterThan(0);
      for(const link of await links.all()) await expect(link).toHaveAttribute('href','https://agroflow-mobile.vercel.app/login');
    }
    for (const route of ['/technology','/get-the-app','/contact#enquire']) {
      await page.goto(route);
      await expect(page.locator('#publicTitle')).toBeVisible();
      await page.addScriptTag({ path:axePath });
      const result=await page.evaluate(async()=> (window as any).axe.run(document,{rules:{'color-contrast':{enabled:true}}}));
      fs.mkdirSync(evidence,{recursive:true});
      fs.writeFileSync(path.join(evidence,`axe-${route.slice(1)}-${theme}-${width}.json`),JSON.stringify(result,null,2));
      expect(result.violations.map((violation:any)=>({id:violation.id,nodes:violation.nodes.map((node:any)=>node.target)}))).toEqual([]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      // Axe cannot measure offscreen carousel captions. Check computed text
      // against both theme surfaces too, including every inactive story stage.
      const contrast=await page.evaluate(()=>{
        const selectors='.hardware-stage h3,.hardware-stage p,.hardware-stage-number,.app-shot figcaption,.app-shots-note,.landing-eyebrow';
        const site=document.querySelector('.visual-site')!;
        const probe=document.createElement('span');site.append(probe);
        const rgb=(value:string)=>{probe.style.color=value;return getComputedStyle(probe).color.match(/[\d.]+/g)!.slice(0,3).map(Number);};
        const luminance=(color:number[])=>color.map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        const style=getComputedStyle(site);
        const surfaces=['--surface','--surface-2'].map(token=>luminance(rgb(style.getPropertyValue(token))));
        const results=Array.from(document.querySelectorAll(selectors)).map(element=>{
          const text=luminance(rgb(getComputedStyle(element).color));
          return {text:element.textContent?.trim(),ratio:Math.min(...surfaces.map(bg=>(Math.max(text,bg)+.05)/(Math.min(text,bg)+.05)))};
        });probe.remove();return results;
      });
      for(const item of contrast) expect(item.ratio,item.text).toBeGreaterThanOrEqual(4.5);
      fs.writeFileSync(path.join(evidence,`contrast-${route.slice(1)}-${theme}-${width}.json`),JSON.stringify(contrast,null,2));
      await page.screenshot({path:path.join(evidence,`${route.slice(1)}-${theme}-${width}.png`),fullPage:true});
    }
    await page.goto('/technology');
    const viewer=page.locator('[data-hardware-viewer]');
    await viewer.scrollIntoViewIfNeeded();
    await expect(viewer).toHaveClass(/is-ready/);
    const size=await viewer.getAttribute('data-canvas-size');
    await page.locator('[data-hardware-reset]').click();
    await page.locator('[data-hardware-toggle]').click();
    for(let i=0;i<27;i++) await page.locator('[data-hardware-rotate="right"]').click();
    await expect(viewer).toHaveAttribute('data-rotation','6.4800');
    const canvas = await page.locator('[data-hardware-canvas]').boundingBox();
    await page.mouse.move(canvas!.x+20,canvas!.y+20); await page.mouse.down();
    await page.mouse.move(canvas!.x+80,canvas!.y+20,{steps:5}); await page.mouse.up();
    await expect(viewer).not.toHaveAttribute('data-rotation','6.4800');
    const rotation=await viewer.getAttribute('data-rotation');
    const requests:string[]=[];
    page.on('request',request=>{if(request.url().includes('/media/scenes/'))requests.push(request.url());});
    await page.locator('[data-hardware-scene="drip-irrigation"]').click();
    await page.locator('[data-hardware-scene="open-field"]').click();
    await page.locator('[data-hardware-stage="3"]').scrollIntoViewIfNeeded();
    await expect(viewer).toHaveAttribute('data-rotation',rotation!);
    await expect(viewer).toHaveAttribute('data-canvas-size',size!);
    expect(requests).toEqual([]);
    expect(await page.locator('[data-hardware-reset]').evaluate(element=>!!element.closest('[data-hardware-viewer]'))).toBe(false);
    await viewer.scrollIntoViewIfNeeded();
    await page.locator('[data-hardware-close]').click();
    await page.locator('[data-hardware-resume]').click();
    await page.locator('[data-hardware-demo]').click();
    await expect(page.locator('[data-irrigation-illustration]')).toHaveAttribute('data-demo-state','running');
    await page.locator('[data-hardware-demo-stop]').click();
    await expect(page.locator('[data-irrigation-illustration]')).toHaveAttribute('data-demo-state','stopped');
  });
}

test('RET-14 staff titles follow authentication and routes',async({page})=>{
  await mockBackend(page,{minDelayMs:5,maxDelayMs:10});
  await page.goto('/staff/#dashboard');
  await expect(page).toHaveTitle('Overview – AgroFlow Staff');
  await page.goto('/staff/#users'); await expect(page).toHaveTitle('Farmers – AgroFlow Staff');
  await page.goto('/staff/#hardware'); await expect(page).toHaveTitle('Kits – AgroFlow Staff');
  fs.mkdirSync(evidence,{recursive:true});
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>localStorage.setItem('agroflow_appearance',theme),theme);
    await page.goto('/staff/#dashboard'); await page.reload();
    await expect(page).toHaveTitle('Overview – AgroFlow Staff');
    await page.screenshot({path:path.join(evidence,`staff-overview-${theme}-1366.png`),fullPage:true});
  }
});

test('RET-14 signed-out staff title is specific',async({page})=>{
  await page.goto('/staff/');
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await expect(page).toHaveTitle('Sign in – AgroFlow Staff');
});

test('the static controller is available when WebGL cannot start',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type:string,...args:any[]) {
      if(type.startsWith('webgl'))return null;
      return (original as any).call(this,type,...args);
    } as any;
  });
  await page.goto('/technology');
  const viewer=page.locator('[data-hardware-viewer]');await viewer.scrollIntoViewIfNeeded();
  await expect(viewer).toHaveClass(/is-fallback/);
  await expect(viewer.locator('.hardware-fallback img')).toBeVisible();
  await expect(page.getByText(/Representative image/)).toBeVisible();
  await expect(page.locator('[data-hardware-demo]')).toBeEnabled();
  fs.mkdirSync(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,'controller-webgl-fallback.png'),fullPage:true});
});

test('the fitted envelope contains the complete swing at every rotation',async({page})=>{
  await page.goto('/technology');
  const extremes=await page.evaluate(async()=>{
    const threePath='/node_modules/.vite/deps/three.js', modelPath='/src/features/hardwareModel.ts', fitPath='/src/features/viewerFraming.ts';
    const THREE=await import(threePath), {buildHardwareModel}=await import(modelPath), {hardwareEnvelope,fitHardwareCamera}=await import(fitPath);
    const model=buildHardwareModel(THREE),envelope=hardwareEnvelope(THREE,model), camera=new THREE.PerspectiveCamera(36,1,.1,200);
    const results=[];
    for(const [width,height] of [[300,390],[550,360]]) {
      fitHardwareCamera(THREE,camera,envelope,width,height);
      let maxX=0,maxY=0;
      for(let step=0;step<72;step++) for(let door=0;door<=12;door++) {
        model.root.rotation.y=step*Math.PI/36;model.lid.rotation.y=-2.05*door/12;model.root.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(model.root);
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
          const point=new THREE.Vector3(x,y,z).project(camera);maxX=Math.max(maxX,Math.abs(point.x));maxY=Math.max(maxY,Math.abs(point.y));
        }
      }
      results.push({maxX,maxY});
    }return results;
  });
  for(const result of extremes){expect(result.maxX).toBeLessThan(.95);expect(result.maxY).toBeLessThan(.95);}
});
