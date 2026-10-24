// The top of the zone screen: Sensor Readings (tiles with a value, its unit, an icon and a
// one-word status), Water Usage (today, this month, water saved) and Zone Details (only
// what is stored, with Edit). Text is never cut off: values and notes wrap.
// Statuses come only from thresholds AgroFlow already has: the zone's own start and stop
// moisture (Low / Good / High), the tank's low line (Low / Good), and "Check sensor" when a
// kit has gone quiet. Temperature, humidity and flow have no thresholds in AgroFlow, so they
// show their value without a status word rather than an invented one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Container, Droplet, Droplets, Gauge, RefreshCw, Thermometer } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow, type Zone } from '@/context/AgroFlowContext';
import { Radius, Space, TypeScale, cardStyle, type AppColors } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import { fetchTankStatus, type TankStatus } from '@/services/agroFlowApi';
import { cropLabel, modeLabel, placeLabel, soilLabel } from '@/lib/labels';
import { dayLabel } from '@/lib/setupHelpers';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
export type TileStatus = 'good' | 'normal' | 'low' | 'high' | 'check' | null;
export type Tile = { key: string; label: string; value: string; unit?: string; status: TileStatus; note?: string };

const hasKit = (z: Zone) => z.sensors.soilMoisture.status === 'Online' || z.sensors.temperatureHumidity.status === 'Online' || !!z.lastReadingAt;

// "5 min ago", "2 h ago", "3 days ago"; "just now" under a minute.
export function agoText(t: T, iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t('sensor.justNow');
  if (mins < 60) return t('sensor.minAgo', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 48) return t('sensor.hoursAgo', { n: hours });
  return t('sensor.daysAgo', { n: Math.round(hours / 24) });
}

// The tiles, worked out from the zone (and the farm's tank). Pure, so it is tested alone.
export function sensorTiles(t: T, zone: Zone, tank: TankStatus | null): Tile[] {
  const kit = hasKit(zone);
  const soil = zone.sensors.soilMoisture;
  const env = zone.sensors.temperatureHumidity;
  const none = (key: string, label: string, note = t('sensor.noReading')): Tile =>
    ({ key, label, value: '—', note, status: kit ? 'check' : null });

  const soilTile: Tile = soil.status !== 'Online' ? none('soil', t('sensor.soil'))
    : !soil.calibrated
      ? { key: 'soil', label: t('sensor.soil'), value: String(Math.round(soil.value)), unit: t('sensor.rawUnit'), status: 'check', note: t('sensor.teachSoil') }
      : { key: 'soil', label: t('sensor.soil'), value: String(Math.round(soil.value)), unit: '%',
          status: soil.moistureStatus === 'Dry' ? 'low' : soil.moistureStatus === 'Wet' ? 'high' : 'good' };
  const tempTile: Tile = env.status !== 'Online' ? none('temp', t('sensor.temperature'))
    : { key: 'temp', label: t('sensor.temperature'), value: String(env.temperature), unit: env.temperatureUnit || '°C', status: null };
  const humTile: Tile = env.status !== 'Online' ? none('hum', t('sensor.humidity'))
    : { key: 'hum', label: t('sensor.humidity'), value: String(env.humidity), unit: env.humidityUnit || '%', status: null };
  const tankTile: Tile = !tank?.capacityLitres
    ? { key: 'tank', label: t('sensor.tank'), value: '—', note: t('sensor.noTank'), status: null }
    : tank.estimatedRemainingLitres == null
      ? { key: 'tank', label: t('sensor.tank'), value: '—', note: t('sensor.noRefill'), status: null }
      : { key: 'tank', label: t('sensor.tank'), value: Math.round(tank.estimatedRemainingLitres).toLocaleString('en-ZA').replace(/,/g, ' '), unit: 'L',
          status: tank.isLow ? 'low' : 'good', note: t('sensor.tankOf', { pct: Math.round((tank.estimatedRemainingLitres / tank.capacityLitres) * 100) }) };
  const flowTile: Tile = zone.water.flowRateLpm > 0
    ? { key: 'flow', label: t('sensor.flow'), value: String(zone.water.flowRateLpm), unit: 'L/min', status: null, note: t('sensor.flowLastRun') }
    : { key: 'flow', label: t('sensor.flow'), value: '—', note: t('empty.noWatering'), status: null };
  return [soilTile, tempTile, humTile, tankTile, flowTile];
}

const ICON = { soil: Droplets, temp: Thermometer, hum: Droplet, tank: Container, flow: Gauge } as const;

export function SensorReadingsCard({ zone }: { zone: Zone }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { farm, refreshZones, isFarmLoading, isZonesLoading } = useAgroFlow();
  const farmId = farm?.id ?? null;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tankFor, setTankFor] = useState<{ farmId: string; value?: TankStatus; failed?: boolean } | null>(null);
  const request = useRef(0);
  const answer = tankFor?.farmId === farmId ? tankFor : null;
  const tank = answer?.value ?? null;
  const dataLoading = !!isFarmLoading || !!isZonesLoading;
  const tankPhase = dataLoading ? 'loading' : !farmId ? 'error' : !answer ? 'loading' : answer.failed ? 'error' : 'value';
  const [refreshing, setRefreshing] = useState(false);
  const loadTank = useCallback(() => {
    const sequence = ++request.current;
    if (!farmId) return;
    setTankFor(null);
    return fetchTankStatus(farmId).then(value => { if (request.current === sequence) setTankFor({ farmId, value }); })
      .catch(() => { if (request.current === sequence) setTankFor({ farmId, failed: true }); });
  }, [farmId]);
  useEffect(() => { void loadTank(); return () => { request.current++; }; }, [loadTank]);
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.resolve(refreshZones()); await loadTank(); } finally { setRefreshing(false); }
  };
  const tiles = sensorTiles(t, zone, tank).map(tile => {
    const pending = tile.key === 'tank' ? tankPhase === 'loading' : dataLoading;
    if (pending) return { ...tile, value: t('common.loading'), unit: undefined, status: null, note: undefined };
    if (tile.key === 'tank' && tankPhase === 'error') return { ...tile, value: '—', unit: undefined, status: null, note: t('home.tankUnavailable') };
    return tile;
  });
  const ago = agoText(t, zone.lastReadingAt);
  return <View style={styles.card} testID="sensor-readings">
    <View style={styles.head}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={styles.title}>{t('sensor.title')}</Text>
        <Text style={styles.sub} testID="sensor-age">{dataLoading ? t('common.loading') : ago ? t('sensor.updated', { ago }) : t('sensor.noReading')}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('sensor.refresh')} accessibilityState={{ busy: refreshing }}
        onPress={() => { void refresh(); }} style={styles.refresh} testID="sensor-refresh" hitSlop={8}>
        <RefreshCw size={18} color={colors.primaryDark} strokeWidth={2} />
        <Text style={styles.refreshText}>{t('sensor.refresh')}</Text>
      </Pressable>
    </View>
    <View style={styles.tiles}>
      {tiles.map(tile => {
        const Icon = ICON[tile.key as keyof typeof ICON];
        return <View key={tile.key} style={styles.tile} testID={`sensor-tile-${tile.key}`}
          accessible accessibilityLabel={[tile.label, tile.value === '—' ? '' : `${tile.value} ${tile.unit ?? ''}`, tile.status ? t(`sensor.status.${tile.status}` as TranslationKey) : '', tile.note ?? ''].filter(Boolean).join(', ')}>
          <View style={styles.tileHead}>
            <Icon size={18} color={colors.textSecondary} strokeWidth={1.8} />
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </View>
          <Text style={styles.value}>{tile.value}{tile.unit ? <Text style={styles.unit}> {tile.unit}</Text> : null}</Text>
          {tile.status ? <Text style={[styles.chip, styles[`chip_${tile.status}`]]}>{t(`sensor.status.${tile.status}` as TranslationKey)}</Text> : null}
          {tile.note ? <Text style={styles.note}>{tile.note}</Text> : null}
        </View>;
      })}
    </View>
  </View>;
}

export function WaterUsageCard({ zone }: { zone: Zone }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { isFarmLoading, isZonesLoading } = useAgroFlow();
  const loading = !!isFarmLoading || !!isZonesLoading;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const litres = (n: number | null | undefined) => (n == null ? null : `${Math.round(n).toLocaleString('en-ZA').replace(/,/g, ' ')} L`);
  const rows = [
    { key: 'today', label: t('usage.today'), value: litres(zone.water.usedTodayLitres) ?? t('empty.noWaterToday') },
    { key: 'month', label: t('usage.month'), value: litres(zone.water.monthLitres) ?? t('empty.noWatering') },
    { key: 'saved', label: t('usage.saved'), value: litres(zone.waterSavedLitres) ?? '—' },
  ];
  return <View style={styles.card} testID="water-usage">
    <Text accessibilityRole="header" style={styles.title}>{t('usage.title')}</Text>
    <View style={styles.tiles}>
      {rows.map(r => <View key={r.key} style={styles.usage} testID={`usage-${r.key}`}>
        <Text style={styles.tileLabel}>{r.label}</Text>
        <Text style={!loading && /^\d/.test(r.value) ? styles.value : styles.muted}>{loading ? t('common.loading') : r.value}</Text>
      </View>)}
    </View>
    <Text style={styles.note}>{t('usage.estimate')}</Text>
  </View>;
}

export function ZoneDetailsCard({ zone, onEdit }: { zone: Zone; onEdit: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { isFarmLoading, isZonesLoading } = useAgroFlow();
  const loading = !!isFarmLoading || !!isZonesLoading;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rows = [
    { label: t('details.crop'), value: cropLabel(t, zone.crop) },
    { label: t('details.planted'), value: zone.plantingDate ? dayLabel(zone.plantingDate) : t('empty.notSet') },
    { label: t('details.soil'), value: zone.soilType ? soilLabel(t, zone.soilType) : t('empty.notSet') },
    { label: t('details.size'), value: zone.size.value ? `${zone.size.value} ${zone.size.unit}` : t('empty.notSet') },
    { label: t('details.place'), value: placeLabel(zone.location) || t('empty.notSet') },
    { label: t('details.mode'), value: modeLabel(t, zone.irrigation.mode) },
    { label: t('details.startAt'), value: `${zone.irrigation.automation.moistureThreshold}%` },
    { label: t('details.stopAt'), value: `${zone.irrigation.automation.desiredMoisture}%` },
    { label: t('details.maxRun'), value: t('setup.maxRun.minutes', { n: zone.maxRunMinutes ?? 5 }) },
  ];
  return <View style={styles.card} testID="zone-details">
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, { flex: 1 }]}>{t('details.title')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('details.editA11y')} onPress={onEdit} style={styles.refresh} testID="zone-details-edit" hitSlop={8}>
        <Text style={styles.refreshText}>{t('details.edit')}</Text>
      </Pressable>
    </View>
    {rows.map((r, i) => <View key={r.label} style={[styles.row, i === rows.length - 1 && styles.rowLast]}>
      <Text style={styles.rowLabel}>{r.label}</Text>
      <Text style={styles.rowValue}>{loading ? t('common.loading') : r.value}</Text>
    </View>)}
  </View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { ...cardStyle(colors), gap: Space.md },
    head: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    title: { color: colors.text, fontSize: TypeScale.section, fontWeight: '700' },
    sub: { color: colors.textSecondary, fontSize: TypeScale.label, marginTop: 2 },
    refresh: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44, paddingHorizontal: Space.sm, borderRadius: Radius.sm },
    refreshText: { color: colors.primaryDark, fontSize: TypeScale.body, fontWeight: '600' },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Space.md },
    tile: { width: '48%', minHeight: 104, padding: Space.md, borderRadius: Radius.sm, backgroundColor: colors.surfaceSecondary, gap: Space.xs },
    usage: { width: '31%', gap: Space.xs },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    tileLabel: { color: colors.textSecondary, fontSize: TypeScale.label, flexShrink: 1 },
    value: { color: colors.text, fontSize: 22, fontWeight: '700' },
    unit: { color: colors.textSecondary, fontSize: TypeScale.label, fontWeight: '500' },
    muted: { color: colors.textSecondary, fontSize: TypeScale.body },
    note: { color: colors.textSecondary, fontSize: TypeScale.small, lineHeight: 16 },
    chip: { alignSelf: 'flex-start', fontSize: TypeScale.small, fontWeight: '700', paddingHorizontal: Space.sm, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', color: colors.text },
    chip_good: { backgroundColor: colors.successBackground },
    chip_normal: { backgroundColor: colors.divider },
    chip_low: { backgroundColor: colors.warningBackground },
    chip_high: { backgroundColor: colors.warningBackground },
    chip_check: { backgroundColor: colors.errorBackground },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.md, paddingVertical: Space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { color: colors.textSecondary, fontSize: TypeScale.body, flexShrink: 1 },
    rowValue: { color: colors.text, fontSize: TypeScale.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  });
}
