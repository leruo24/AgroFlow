// Web raster preview: a small visible tile set, no prefetching, no panning.
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { MapChrome } from '@/constants/colors';
import { farmMapSurfaceStyles as styles } from '@/styles/farmMapSurfaceStyles';
export type FarmMapSurfaceProps = { latitude: number; longitude: number; zoom: number; onFailure: () => void };
export default function FarmMapSurface({ latitude, longitude, zoom, onFailure }: FarmMapSurfaceProps) {
  const [width, setWidth] = useState(0);
  const [loadedZoom, setLoadedZoom] = useState<number | null>(null);
  const size = 256, height = 190, scale = 2 ** zoom;
  const x = (longitude + 180) / 360 * scale * size;
  const radians = Math.max(-85.05, Math.min(85.05, latitude)) * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * scale * size;
  useEffect(() => { if (loadedZoom === zoom) return; const timer = setTimeout(onFailure, 12000); return () => clearTimeout(timer); }, [loadedZoom, zoom, onFailure]);
  const tiles = [];
  if (width) for (let tx = Math.floor((x - width / 2) / size); tx <= Math.floor((x + width / 2) / size); tx++) {
    for (let ty = Math.floor((y - height / 2) / size); ty <= Math.floor((y + height / 2) / size); ty++) {
      if (ty < 0 || ty >= scale) continue;
      // Each tile's position comes from pan/zoom state, so it stays inline instead of in the
      // style file.
      tiles.push(<Image key={`${zoom}-${tx}-${ty}`} source={{ uri: `https://tile.openstreetmap.org/${zoom}/${((tx % scale) + scale) % scale}/${ty}.png` }}
        onLoad={() => setLoadedZoom(zoom)} onError={onFailure} style={{ position: 'absolute', width: size, height: size, left: tx * size - x + width / 2, top: ty * size - y + height / 2 }} />);
    }
  }
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.webContainer} accessibilityLabel="Farm location map. Use the zoom buttons to change scale.">
    {tiles}<View style={[styles.pinWrapper, { pointerEvents: 'none' }]}><MapPin size={30} color={MapChrome.pinColor} fill={MapChrome.attributionBackground} /></View>
    <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }} style={styles.attribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></Pressable>
  </View>;
}
