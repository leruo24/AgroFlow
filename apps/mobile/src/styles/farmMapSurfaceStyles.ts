import { StyleSheet } from 'react-native';
import { FixedMediaHeight, MapChrome, Type } from '@/constants/colors';

// No theme dependency here on purpose - map tiles/imagery set the visual
// tone, and the chrome drawn over them (pin, attribution) must stay legible
// regardless of which theme is active. See MapChrome/FixedMediaHeight.
export const farmMapSurfaceStyles = StyleSheet.create({
  // Native surface: a WebView running Leaflet over OpenStreetMap tiles.
  // Previously react-native-maps, which rendered through Google Maps on
  // Android and so needed an API key the project never had - the map never
  // loaded there at all.
  map: { height: FixedMediaHeight.farmMap },

  // Web raster-tile surface. Same OpenStreetMap tiles as native, drawn
  // directly as images rather than through Leaflet.
  webContainer: { height: FixedMediaHeight.farmMap, overflow: 'hidden' },
  pinWrapper: { position: 'absolute', left: '50%', top: '50%', marginLeft: -15, marginTop: -30 },
  attribution: { position: 'absolute', bottom: 0, right: 0, backgroundColor: MapChrome.attributionBackground, padding: 5 },
  attributionText: { color: MapChrome.attributionText, fontSize: Type.label },
});
