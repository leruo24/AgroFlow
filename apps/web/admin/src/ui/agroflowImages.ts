import { text as t } from '@/pages/publicCopy';
import manifest from './agroflow-images.manifest.json';

export const agroflowImages = {
  aerial:'agroflow_farm_aerial', sprinkler:'agroflow_sprinkler_closeup',
  irrigation:'agroflow_field_irrigation', seedling:'agroflow_planting_seedling',
  greenhouse:'agroflow_tomato_greenhouse_evening', reservoir:'agroflow_water_reservoir',
  hero:'agroflow_hero_farm', sensor:'agroflow_more_field_sensor',
  crops:'agroflow_more_leafy_crops', tanks:'agroflow_more_water_tanks',
} as const;
export type AgroflowImage = keyof typeof agroflowImages;
// Identity only; never random, location-derived, or evidence of a customer's crop.
export function farmImageKey(id: string | number): AgroflowImage {
  const choices:AgroflowImage[]=['aerial','irrigation','hero','reservoir'];
  let hash=0;for(const char of String(id))hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  return choices[hash%choices.length]!;
}
export function imageHtml(key:AgroflowImage,priority=false):string {
  const stem=agroflowImages[key], base='/images/agroflow/optimized/';
  const image=manifest.find(image=>image.original.replace(/\.[^.]+$/,'')===stem)!;
  const variants=image.variants, fallback=variants[Math.min(1,variants.length-1)]!;
  return `<img src="${base}${fallback.file}" srcset="${variants.map(item=>`${base}${item.file} ${item.width}w`).join(', ')}" sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1100px) 50vw, 600px" width="${fallback.width}" height="${fallback.height}" alt="" loading="${priority?'eager':'lazy'}" decoding="async" ${priority?'fetchpriority="high"':''} />`;
}
export function photoHtml(key:AgroflowImage,priority=false):string {
  return `<figure class="premium-photo">${imageHtml(key,priority)}<figcaption>${t('representativePhoto')}</figcaption></figure>`;
}
export function contextPhotoHtml(key:AgroflowImage):string {
  return `<figure class="premium-context">${imageHtml(key)}<figcaption>${t('representativePhoto')}</figcaption></figure>`;
}
