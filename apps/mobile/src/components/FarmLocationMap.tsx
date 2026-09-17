import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, MapPin, Minus, Plus } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import type { Farm } from '@/context/AgroFlowContext';
import { createFarmLocationMapStyles } from '@/styles/farmLocationMapStyles';
import FarmMapSurface from './FarmMapSurface';

export function hasCoordinates(farm: Pick<Farm, 'latitude' | 'longitude'>) {
  return farm.latitude != null && farm.longitude != null && Number.isFinite(farm.latitude) && Number.isFinite(farm.longitude)
    && Math.abs(farm.latitude) <= 90 && Math.abs(farm.longitude) <= 180;
}
export function FarmLocationMap({ farm }: { farm: Farm }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createFarmLocationMapStyles(colors), [colors]);
  const [collapsed, setCollapsed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(13);
  const onFailure = useCallback(() => setFailed(true), []);
  const valid = hasCoordinates(farm);
  const location = farm.location?.trim();
  if (!valid && !location) return null;
  const text = location || `${farm.latitude!.toFixed(4)}, ${farm.longitude!.toFixed(4)}`;
  const canShow = valid && !failed;
  return <View style={styles.container}>
    <Pressable accessibilityRole={canShow ? 'button' : 'text'} accessibilityLabel={`${text}${canShow ? (collapsed ? ', expand map' : ', collapse map') : ''}`} accessibilityState={{ expanded: canShow && !collapsed }} disabled={!canShow} onPress={() => setCollapsed(v => !v)} style={styles.row}>
      <MapPin size={20} color={colors.textSecondary} /><Text style={styles.rowText}>{text}</Text>
      {canShow && (collapsed ? <ChevronDown size={20} color={colors.textSecondary} /> : <ChevronUp size={20} color={colors.textSecondary} />)}
    </Pressable>
    {canShow && !collapsed && <View style={styles.mapWrapper}>
      <FarmMapSurface latitude={farm.latitude!} longitude={farm.longitude!} zoom={zoom} onFailure={onFailure} />
      <View style={styles.zoomControls}>
        {[{ Icon: Plus, step: 1, label: 'Zoom in' }, { Icon: Minus, step: -1, label: 'Zoom out' }].map(({ Icon, step, label }) => {
          const disabled = zoom + step < 4 || zoom + step > 17;
          return <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => setZoom(z => Math.min(17, Math.max(4, z + step)))} style={[styles.zoomButton, { opacity: disabled ? 0.35 : 1 }]}><Icon size={21} color={colors.text} /></Pressable>;
        })}
      </View>
    </View>}
    {failed && <Text style={styles.unavailableText}>Map unavailable. Farm location is shown above.</Text>}
  </View>;
}
