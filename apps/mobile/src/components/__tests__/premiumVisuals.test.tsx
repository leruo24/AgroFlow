import {farmImageKey,zoneImageKey} from '@/components/visual/agroflowImages';
test('farm fallback art is stable and never selected by a guessed crop',()=>{
  for(const id of ['farm-1','farm-2','1'])expect(farmImageKey(id)).toBe(farmImageKey(id));
  expect(zoneImageKey('1','unknown')).toBe(farmImageKey('1'));
  expect(zoneImageKey('1','maize')).not.toBe('greenhouse');
  expect(zoneImageKey('1','tomato')).toBe('greenhouse');
  expect(zoneImageKey('1','leafy_veg')).toBe('crops');
});
