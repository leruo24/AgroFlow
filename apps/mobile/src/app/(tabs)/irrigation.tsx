import { useMemo } from 'react';
import { router } from '@/lib/router';
import { ChevronRight, Droplets } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FarmSelector } from '@/components/FarmSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';
import { createIrrigationStyles } from '@/styles/irrigationStyles';

export default function IrrigationScreen() {
  const { farm, zones, isZonesLoading, zonesError, refreshZones, isFarmLoading, farmError, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const styles = useMemo(() => ({ ...createScreenStyles(colors), ...createIrrigationStyles(colors) }), [colors]);
  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const scheduled = zones.filter(z => z.irrigation.mode === 'scheduled' && z.irrigation.schedule.enabled).length;
  const openZone = (id: string) => router.push({ pathname: '/zone/[id]', params: { id } });
  return <SafeAreaView style={styles.page} edges={['top']}><ScrollView contentContainerStyle={styles.content}>
    <ScreenHeader title="Irrigation" subtitle="Monitor and manage your farm’s zones." help="irrigation" />
    <FarmSelector />
    <View style={styles.summary}>{[
      ['Total zones', loading || error ? '—' : String(zones.length)],
      ['Irrigating', 'Unknown'],
      ['Scheduled', loading || error ? '—' : String(scheduled)],
    ].map(([label, value]) => <View key={label} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.caption}>{label}</Text></View>)}</View>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Irrigation zones</Text>
    {loading ? <DataState kind="loading" title="Loading zones" />
      : error ? <DataState kind="error" title="Unable to load zones" description="Check your connection and try again." onRetry={farmError ? refreshFarms : refreshZones} />
      : !farm ? <DataState kind="empty" title="No farm assigned yet" />
      : zones.length === 0 ? <DataState kind="empty" title="No zones set up yet" description="Connected zones will appear here." />
      : zones.map(zone => <View key={zone.id} style={styles.row}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Open ' + zone.name} onPress={() => openZone(zone.id)} style={[styles.rowTop, { minHeight: 48 }]}>
          <Droplets size={23} color={colors.textSecondary} strokeWidth={1.7} /><Text style={styles.title}>{zone.name}</Text><ChevronRight size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.caption}>{zone.location} · {zone.crop}</Text>
        <Text style={styles.body}>{zone.irrigation.override.active ? 'Manual command accepted — device confirmation unavailable' : zone.irrigation.mode === 'scheduled' ? (zone.irrigation.schedule.enabled ? 'Schedule enabled' : 'Schedule disabled') : 'Automatic mode'} · Health: {zone.healthStatus}</Text>
        <View style={styles.metrics}>
          {[
            ['Soil moisture', zone.sensors.soilMoisture.status === 'Online' ? zone.sensors.soilMoisture.value + '%' : 'No reading'],
            ['Temperature', zone.sensors.temperatureHumidity.status === 'Online' ? zone.sensors.temperatureHumidity.temperature + '°C' : 'No reading'],
            ['Water recorded today', zone.water.usedTodayLitres != null ? zone.water.usedTodayLitres + ' L' : 'No data'],
            ['Last irrigation', zone.irrigation.lastIrrigation.date],
          ].map(([label, value]) => <View key={label} style={styles.metric}><Text style={styles.caption}>{label}</Text><Text style={styles.body}>{value}</Text></View>)}
        </View>
        {zone.alerts.length > 0 && <Text style={styles.caption}>{zone.alerts.length} alert(s) for this zone</Text>}
        <TouchableOpacity accessibilityRole="button" style={styles.secondaryButton} onPress={() => openZone(zone.id)}><Text style={styles.buttonText}>Manage Zone</Text></TouchableOpacity>
      </View>)}
  </ScrollView></SafeAreaView>;
}
