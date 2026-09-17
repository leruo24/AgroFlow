import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MapChrome } from '@/constants/colors';
import { farmMapSurfaceStyles as styles } from '@/styles/farmMapSurfaceStyles';
import type { FarmMapSurfaceProps } from './FarmMapSurface';
export default function FarmMapSurface({ latitude, longitude, zoom, onFailure }: FarmMapSurfaceProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (ready) return; const timer = setTimeout(onFailure, 12000); return () => clearTimeout(timer); }, [ready, onFailure]);
  const delta = 360 / (2 ** zoom);
  return <MapView style={styles.map} region={{ latitude, longitude, latitudeDelta: delta, longitudeDelta: delta }}
    scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} zoomTapEnabled={false}
    showsUserLocation={false} showsPointsOfInterests={false} toolbarEnabled={false}
    onMapReady={() => { if (Platform.OS === 'ios') setReady(true); }} onMapLoaded={() => setReady(true)}>
    <Marker coordinate={{ latitude, longitude }} draggable={false} pinColor={MapChrome.pinColor} />
  </MapView>;
}
