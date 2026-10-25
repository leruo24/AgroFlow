// Optimised copies of the supplied representative imagery; never farm evidence.
export const agroflowImages = {
  aerial:require('../../../assets/images/agroflow/agroflow_farm_aerial.webp'),
  hero:require('../../../assets/images/agroflow/agroflow_hero_farm.webp'),
  irrigation:require('../../../assets/images/agroflow/agroflow_field_irrigation.webp'),
  sprinkler:require('../../../assets/images/agroflow/agroflow_sprinkler_closeup.webp'),
  seedling:require('../../../assets/images/agroflow/agroflow_planting_seedling.webp'),
  greenhouse:require('../../../assets/images/agroflow/agroflow_tomato_greenhouse_evening.webp'),
  reservoir:require('../../../assets/images/agroflow/agroflow_water_reservoir.webp'),
  sensor:require('../../../assets/images/agroflow/agroflow_more_field_sensor.webp'),
  crops:require('../../../assets/images/agroflow/agroflow_more_leafy_crops.webp'),
  tanks:require('../../../assets/images/agroflow/agroflow_more_water_tanks.webp'),
} as const;
export type AgroflowImage=keyof typeof agroflowImages;
export function farmImageKey(id:string|number):AgroflowImage {
  const choices:AgroflowImage[]=['aerial','irrigation','hero','reservoir'];
  let hash=0;for(const char of String(id))hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  return choices[hash%choices.length];
}
export function zoneImageKey(id:string,crop:string):AgroflowImage {
  if(/tomato/i.test(crop))return 'greenhouse';
  if(/leafy|spinach|lettuce|cabbage|chard/i.test(crop))return 'crops';
  return farmImageKey(id);
}
