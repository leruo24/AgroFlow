import { StyleSheet } from 'react-native';
import { FixedMediaHeight, MapChrome, Type } from '@/constants/colors';

// No theme dependency here on purpose - map tiles/imagery set the visual
// tone, and the chrome drawn over them (pin, attribution) must stay legible
// regardless of which theme is active. See MapChrome/FixedMediaHeight.
export const farmMapSurfaceStyles = StyleSheet.create({
  // Native (react-native-maps) surface.
  map: { height: FixedMediaHeight.farmMap },

  // Web raster-tile fallback surface.
  webContainer: { height: FixedMediaHeight.farmMap, overflow: 'hidden' },
  pinWrapper: { position: 'absolute', left: '50%', top: '50%', marginLeft: -15, marginTop: -30 },
  attribution: { position: 'absolute', bottom: 0, right: 0, backgroundColor: MapChrome.attributionBackground, padding: 5 },
  attributionText: { color: MapChrome.attributionText, fontSize: Type.label },
});
