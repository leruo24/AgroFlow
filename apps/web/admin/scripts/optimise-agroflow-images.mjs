// Reproducible, non-generative variants of the supplied representative images.
// Originals are never overwritten. Run from apps/web/admin after npm ci.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const admin=fileURLToPath(new URL('..',import.meta.url));
const source=path.join(admin,'public/images/agroflow');
const web=path.join(source,'optimized');
const mobile=path.resolve(admin,'../../mobile/assets/images/agroflow');
await fs.mkdir(web,{recursive:true});await fs.mkdir(mobile,{recursive:true});
const report=[];
for(const name of (await fs.readdir(source)).filter(name=>/\.(png|jpe?g)$/i.test(name)).sort()) {
  const input=path.join(source,name), stem=path.parse(name).name;
  const metadata=await sharp(input).metadata();
  const variants=[];
  for(const width of [...new Set([480,960,1600].map(width=>Math.min(width,metadata.width)))]) {
    const output=path.join(web,`${stem}-${width}.webp`);
    const info=await sharp(input).rotate().resize({width,withoutEnlargement:true}).webp({quality:78,effort:5}).toFile(output);
    variants.push({file:path.basename(output),width:info.width,height:info.height,bytes:info.size});
  }
  const native=path.join(mobile,`${stem}.webp`);
  const info=await sharp(input).rotate().resize({width:960,withoutEnlargement:true}).webp({quality:78,effort:5}).toFile(native);
  report.push({original:name,bytes:(await fs.stat(input)).size,width:metadata.width,height:metadata.height,variants,mobileBytes:info.size});
}
await fs.writeFile(path.join(admin,'src/ui/agroflow-images.manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
