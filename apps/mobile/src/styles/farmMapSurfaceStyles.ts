import { StyleSheet } from 'react-native';
import { FixedMediaHeight, MapChrome, Type, Space } from '@/constants/colors';

// No theme here on purpose: the map tiles set the look, and the pin and attribution drawn
// over them must stay readable in any theme. See MapChrome/FixedMediaHeight.
export const farmMapSurfaceStyles = StyleSheet.create({
  // Native surface: a WebView running Leaflet over OpenStreetMap tiles (no Google Maps key
  // needed).
  map: { height: FixedMediaHeight.farmMap },

  // Web surface: the same OpenStreetMap tiles, drawn directly as images instead of through Leaflet.
  webContainer: { height: FixedMediaHeight.farmMap, overflow: 'hidden' },
  pinWrapper: { position: 'absolute', left: '50%', top: '50%', marginLeft: -15, marginTop: -30 },
  attribution: { position: 'absolute', bottom: 0, right: 0, backgroundColor: MapChrome.attributionBackground, padding: Space.xs },
  attributionText: { color: MapChrome.attributionText, fontSize: Type.label },
});
