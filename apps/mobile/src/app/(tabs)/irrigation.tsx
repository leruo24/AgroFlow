import { useMemo } from 'react';
import { router } from '@/lib/router';
import { ChevronRight, Droplets } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FarmSelector } from '@/components/FarmSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { Card, CardList } from '@/components/ui/Card';
import { InfoGrid } from '@/components/ui/InfoGrid';
import { StatsRow } from '@/components/ui/StatsRow';
import { useAgroFlow, type Zone } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { createScreenStyles } from '@/styles/screenStyles';
import { createIrrigationStyles } from '@/styles/irrigationStyles';
import { soilReadingText } from '@/lib/moistureDisplay';
import { cropLabel, healthLabel, placeLabel } from '@/lib/labels';
import { dayLabel } from '@/lib/setupHelpers';

// A zone has (or had) a kit when any of its sensors has reported.
export const zoneHasKit = (z: Zone) => z.sensors.soilMoisture.status === 'Online' || z.sensors.temperatureHumidity.status === 'Online';

export default function IrrigationScreen() {
  const { farm, zones, isZonesLoading, zonesError, refreshZones, isFarmLoading, farmError, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const { t } = useI18n();
  const bottom = useBottomPadding();
  const styles = useMemo(() => ({ ...createScreenStyles(colors), ...createIrrigationStyles(colors) }), [colors]);
  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const scheduled = zones.filter(z => z.irrigation.mode === 'scheduled' && z.irrigation.schedule.enabled).length;
  // There is no valve feedback, so "watering now" counts runs the farmer or AgroFlow started
  // and the kit accepted; with no kit at all there is nothing to count.
  const anyKit = zones.some(zoneHasKit);
  const running = zones.filter(z => z.irrigation.override.active).length;
  const openZone = (id: string) => router.push({ pathname: '/zone/[id]', params: { id } });
  const busy = loading || !!error;

  const modeText = (zone: Zone) => zone.irrigation.override.active ? t('irrigation.runAccepted')
    : zone.irrigation.mode === 'scheduled' ? (zone.irrigation.schedule.enabled ? t('irrigation.scheduleOn') : t('irrigation.scheduleOff'))
    : zone.irrigation.mode === 'manual' ? t('irrigation.manualMode') : t('irrigation.autoMode');

  return <SafeAreaView style={styles.page} edges={['top']}><ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
    <ScreenHeader title={t('irrigation.title')} subtitle={t('irrigation.subtitle')} help="irrigation" />
    <FarmSelector />
    <StatsRow testID="irrigation-stats" stats={[
      { label: t('irrigation.totalZones'), value: busy ? '—' : String(zones.length) },
      busy || anyKit
        ? { label: t('irrigation.wateringNow'), value: busy ? '—' : String(running) }
        : { label: t('irrigation.wateringNow'), value: '—', note: t('empty.noKit') },
      { label: t('irrigation.scheduled'), value: busy ? '—' : String(scheduled) },
    ]} />
    <Text accessibilityRole="header" style={styles.sectionTitle}>{t('irrigation.zones')}</Text>
    {loading ? <DataState kind="loading" title={t('irrigation.loading')} />
      : error ? <DataState kind="error" title={t('irrigation.loadFailed')} description={t('irrigation.checkConnection')} onRetry={farmError ? refreshFarms : refreshZones} />
      : !farm ? <DataState kind="empty" title={t('irrigation.noFarm')} />
      : zones.length === 0 ? <DataState kind="empty" title={t('irrigation.noZones')} description={t('irrigation.noZonesBody')} />
      : <CardList>{zones.map(zone => {
        const kit = zoneHasKit(zone);
        const place = [placeLabel(zone.location), cropLabel(t, zone.crop)].filter(Boolean).join(' · ');
        return <Card key={zone.id} testID={`irrigation-zone-${zone.id}`}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('irrigation.open', { zone: zone.name })} onPress={() => openZone(zone.id)} style={[styles.rowTop, { minHeight: 48 }]}>
            <Droplets size={23} color={colors.textSecondary} strokeWidth={1.7} /><Text style={styles.title} numberOfLines={2}>{zone.name}</Text><ChevronRight size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {place ? <Text style={styles.caption}>{place}</Text> : null}
          <Text style={styles.body}>{modeText(zone)} · {t('irrigation.health', { health: healthLabel(t, zone.healthStatus) })}</Text>
          <InfoGrid items={[
            kit ? { label: t('irrigation.soilMoisture'), value: soilReadingText(zone.sensors.soilMoisture, t('empty.noReading')), muted: zone.sensors.soilMoisture.status !== 'Online' }
              : { label: t('irrigation.soilMoisture'), value: t('empty.noKit'), muted: true },
            kit ? { label: t('irrigation.temperature'), value: zone.sensors.temperatureHumidity.status === 'Online' ? `${zone.sensors.temperatureHumidity.temperature}°C` : t('empty.noReading'), muted: zone.sensors.temperatureHumidity.status !== 'Online' }
              : { label: t('irrigation.temperature'), value: '—', muted: true },
            { label: t('irrigation.waterToday'), value: zone.water.usedTodayLitres != null ? `${zone.water.usedTodayLitres} L` : t('empty.noWaterToday'), muted: zone.water.usedTodayLitres == null },
            { label: t('irrigation.lastWatering'), value: /^\d{4}-\d{2}-\d{2}$/.test(zone.irrigation.lastIrrigation.date) ? dayLabel(zone.irrigation.lastIrrigation.date) : t('empty.noWatering'), muted: !/^\d{4}/.test(zone.irrigation.lastIrrigation.date) },
          ]} />
          {zone.alerts.length > 0 && <Text style={styles.caption}>{t('irrigation.alerts', { n: zone.alerts.length })}</Text>}
          <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => openZone(zone.id)} testID={`manage-zone-${zone.id}`}><Text style={styles.buttonText}>{t('irrigation.manage')}</Text></TouchableOpacity>
        </Card>;
      })}</CardList>}
  </ScrollView></SafeAreaView>;
}
