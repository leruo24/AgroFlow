import { useMemo } from 'react';
import { router } from 'expo-router';
import { Bell, ChevronRight, Clock3, Droplets, Settings2 } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';
import { createHomeStyles } from '@/styles/homeStyles';
import { FarmSelector } from '@/components/FarmSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { FarmLocationMap } from '@/components/FarmLocationMap';
import { WeatherSummary } from '@/components/WeatherSummary';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { farm, isFarmLoading, farmError, zones, isZonesLoading, zonesError, refreshZones, refreshFarms, alerts } = useAgroFlow();
  // Shared vocabulary (screenStyles) plus this screen's own two styles
  // (homeStyles) - kept as separate factories so Home can change without
  // touching what Alerts/History/Irrigation share.
  const styles = useMemo(() => ({ ...createScreenStyles(colors), ...createHomeStyles(colors) }), [colors]);
  const measured = zones.filter(z => z.sensors.soilMoisture.status === 'Online');
  const moisture = measured.length ? Math.round(measured.reduce((sum, z) => sum + z.sensors.soilMoisture.value, 0) / measured.length) + '%' : 'No reading';
  const unread = alerts.filter(a => !a.read).length;
  const pendingCommands = zones.filter(z => z.irrigation.override.active).length;
  // null usedTodayLitres means no zone_daily_water_usage row exists for that
  // zone today - only sum zones that actually have one, and say so plainly
  // rather than reporting a 0 no zone actually recorded.
  const zonesWithUsage = zones.filter(z => z.water.usedTodayLitres != null);
  const waterToday = zonesWithUsage.length === 0
    ? 'No data'
    : Math.round(zonesWithUsage.reduce((sum, z) => sum + z.water.usedTodayLitres!, 0)) + ' L';
  const metrics = [
    { label: 'Avg soil moisture', value: moisture },
    // No live valve/relay feedback exists, so this stays honest rather than
    // deriving a number that would imply confirmed hardware state.
    { label: 'Irrigating', value: 'Unknown' },
    { label: 'Recorded water today', value: waterToday },
    { label: 'Unread alerts', value: String(unread) },
  ];
  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader title="AgroFlow" subtitle="Your farm at a glance." help="home" />
      <FarmSelector />
      {isFarmLoading ? <DataState kind="loading" title="Loading farm information" />
        : farmError ? <DataState kind="error" title="Farm information unavailable" description="We couldn’t load the latest farm details. Your navigation and saved settings are still available." onRetry={refreshFarms} />
        : !farm ? <DataState kind="empty" title="No farm assigned yet" description="Your farm will appear here once it has been assigned to your account." />
        : <>
          <FarmLocationMap key={farm.id} farm={farm} />
          <WeatherSummary key={farm.id + '-' + farm.latitude + '-' + farm.longitude} farm={farm} />
          <Text accessibilityRole="header" style={styles.sectionTitle}>Farm status</Text>
          {isZonesLoading ? <DataState kind="loading" title="Loading farm status" />
            : zonesError ? <DataState kind="error" title="Farm status unavailable" onRetry={refreshZones} />
            : zones.length === 0 ? <DataState kind="empty" title="No zones set up yet" description="Sensor readings and irrigation activity will appear when a zone is connected." />
            : <>
              <View style={styles.metrics}>{metrics.map(metric => <View key={metric.label} style={styles.metric}><Text style={styles.statValue}>{metric.value}</Text><Text style={styles.caption}>{metric.label}</Text></View>)}</View>
              <Text style={styles.caption}>{pendingCommands > 0 ? pendingCommands + ' manual command(s) accepted. ' : ''}Live valve confirmation is unavailable.</Text>
            </>}
        </>}
      <Text accessibilityRole="header" style={styles.sectionTitle}>Quick actions</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.primaryAction} onPress={() => router.push('/irrigation')}>
        <Droplets size={22} color={colors.white} strokeWidth={1.7} /><Text style={styles.primaryActionText}>Manage Irrigation</Text><ChevronRight size={20} color={colors.white} />
      </TouchableOpacity>
      {[
        { label: 'View Alerts', route: '/alerts' as const, Icon: Bell },
        { label: 'View History', route: '/history' as const, Icon: Clock3 },
        { label: 'Settings', route: '/settings' as const, Icon: Settings2 },
      ].map(({ label, route, Icon }) => <TouchableOpacity key={route} accessibilityRole="button" style={styles.actionRow} onPress={() => router.push(route)}>
        <Icon size={21} color={colors.textSecondary} strokeWidth={1.7} /><Text style={styles.actionText}>{label}</Text>
        {route === '/alerts' && unread > 0 && <Text style={styles.caption}>{unread} unread</Text>}
        <ChevronRight size={19} color={colors.textSecondary} />
      </TouchableOpacity>)}
    </ScrollView>
  </SafeAreaView>;
}
