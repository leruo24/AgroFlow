import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { router } from '@/lib/router';
import { Bell, ChevronRight, Clock3, CloudSun, Container, Droplets, FileText, Settings2 } from 'lucide-react-native';
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
import { DripHelper } from '@/components/DripHelper';
import { averageSoilText } from '@/lib/moistureDisplay';
import { TodayCard } from '@/components/TodayCard';
import { SetupCard } from '@/components/SetupCard';
import { fetchFarmToday, fetchTankStatus, type TankStatus, type TodayZone } from '@/services/agroFlowApi';
import { useI18n } from '@/i18n';
import { onReconnect } from '@/lib/connectivity';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { farm, isFarmLoading, farmError, zones, isZonesLoading, zonesError, refreshZones, refreshFarms, alerts } = useAgroFlow();
  // Shared screen styles plus Home's own, kept separate so Home can change
  // without affecting Alerts, History and Irrigation.
  const styles = useMemo(() => ({ ...createScreenStyles(colors), ...createHomeStyles(colors) }), [colors]);
  // Only set-up zones: an uncalibrated sensor number is not a percentage.
  const moisture = averageSoilText(zones.map(z => z.sensors.soilMoisture));
  const unread = alerts.filter(a => !a.read).length;
  // Today's cards come from GET /api/farmer/farms/{id}/today on the API.
  const [today, setToday] = useState<TodayZone[] | null>(null);
  const [todayFailed, setTodayFailed] = useState(false);
  const loadToday = useCallback(() => {
    if (!farm) return;
    fetchFarmToday(farm.id)
      .then(r => { setToday(r.zones); setTodayFailed(false); })
      .catch(() => setTodayFailed(true));
  }, [farm]);
  useEffect(() => { setToday(null); loadToday(); }, [loadToday]);
  const [tank, setTank] = useState<TankStatus | null>(null);
  const [tankFailed, setTankFailed] = useState(false);
  const loadTank = useCallback(() => {
    if (!farm) return;
    fetchTankStatus(farm.id).then(value => { setTank(value); setTankFailed(false); }).catch(() => setTankFailed(true));
  }, [farm]);
  useFocusEffect(loadTank);
  // Back online: swap the saved copies for live ones.
  useEffect(() => onReconnect(() => { loadToday(); loadTank(); }), [loadToday, loadTank]);
  const pendingCommands = zones.filter(z => z.irrigation.override.active).length;
  // null usedTodayLitres means the zone has no zone_daily_water_usage row today,
  // so we only add up zones that have one instead of showing a false 0.
  const zonesWithUsage = zones.filter(z => z.water.usedTodayLitres != null);
  const waterToday = zonesWithUsage.length === 0
    ? t('home.noData')
    : Math.round(zonesWithUsage.reduce((sum, z) => sum + z.water.usedTodayLitres!, 0)) + ' L';
  const metrics = [
    { label: t('home.metricMoisture'), value: moisture },
    // There is no valve or relay feedback, so we show Unknown instead of guessing.
    { label: t('home.metricIrrigating'), value: t('home.unknown') },
    { label: t('home.metricWater'), value: waterToday },
    { label: t('home.metricAlerts'), value: String(unread) },
  ];
  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader title="AgroFlow" subtitle={t('home.subtitle')} help="home" />
      <FarmSelector />
      {isFarmLoading ? <DataState kind="loading" title={t('home.loadingFarm')} />
        : farmError ? <DataState kind="error" title={t('home.farmUnavailable')} description={t('home.farmUnavailableBody')} onRetry={refreshFarms} />
        : !farm ? <DataState kind="empty" title={t('home.noFarm')} description={t('home.noFarmBody')} />
        : <>
          {/* Setup still to finish comes first; it is gone once setup is complete. */}
          <SetupCard />
          {/* Today next: it is what a farmer opens the app to find out. */}
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.today')}</Text>
          {todayFailed ? <DataState kind="error" title={t('home.todayUnavailable')} onRetry={loadToday} />
            : today === null ? <DataState kind="loading" title={t('home.todayLoading')} />
            : today.length === 0 ? <DataState kind="empty" title={t('home.noZones')} description={t('home.noZonesToday')} />
            : today.map(z => <TodayCard key={z.zoneId} zone={z} onLogged={loadToday} />)}
          <FarmLocationMap key={farm.id} farm={farm} />
          <WeatherSummary key={farm.id + '-' + farm.latitude + '-' + farm.longitude} farm={farm} />
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.tank')}</Text>
          {tankFailed ? <DataState kind="error" title={t('home.tankUnavailable')} onRetry={loadTank} />
            : <View style={styles.tankCard}>
              <Text style={styles.tankEstimate}>{tank?.estimatedRemainingLitres != null
                ? t('home.tankLeft', { litres: Math.round(tank.estimatedRemainingLitres) })
                : tank?.capacityLitres ? t('home.tankNoRefill') : t('home.tankNotSetUp')}</Text>
              {tank?.waterPhWarning ? <Text style={styles.caption}>{tank.waterPhWarning}</Text> : null}
              {/* Expo's generated route declaration is refreshed by the dev server; this new
                  file is already bundled by export, but the checked local declaration is stale. */}
              <TouchableOpacity accessibilityRole="button" style={styles.tankLinkTarget} onPress={() => router.push('/tank' as never)}><Text style={styles.tankLink}>{t('home.tankLink')}</Text></TouchableOpacity>
            </View>}
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.farmStatus')}</Text>
          {isZonesLoading ? <DataState kind="loading" title={t('home.farmStatusLoading')} />
            : zonesError ? <DataState kind="error" title={t('home.farmStatusUnavailable')} onRetry={refreshZones} />
            : zones.length === 0 ? <DataState kind="empty" title={t('home.noZones')} description={t('home.noZonesStatus')} />
            : <>
              <View style={styles.metrics}>{metrics.map(metric => <View key={metric.label} style={styles.metric}><Text style={styles.statValue}>{metric.value}</Text><Text style={styles.caption}>{metric.label}</Text></View>)}</View>
              <Text style={styles.caption}>{pendingCommands > 0 ? t('home.commandsAccepted', { count: pendingCommands }) : ''}{t('home.noValveFeedback')}</Text>
            </>}
        </>}
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.quickActions')}</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.primaryAction} onPress={() => router.push('/irrigation')}>
        <Droplets size={22} color={colors.white} strokeWidth={1.7} /><Text style={styles.primaryActionText}>{t('home.waterAZone')}</Text><ChevronRight size={20} color={colors.white} />
      </TouchableOpacity>
      {[
        // Forecast first: it answers the question farmers have before opening the
        // app ("do I water tomorrow?").
        { label: t('home.weekAhead'), route: '/forecast' as const, Icon: CloudSun },
        { label: t('home.viewAlerts'), route: '/alerts' as const, Icon: Bell },
        { label: t('home.logRefill'), route: '/tank?refill=1' as never, Icon: Container },
        { label: t('home.viewHistory'), route: '/history' as const, Icon: Clock3 },
        { label: t('home.reports'), route: '/reports' as const, Icon: FileText },
        { label: t('home.settings'), route: '/settings' as const, Icon: Settings2 },
      ].map(({ label, route, Icon }) => <TouchableOpacity key={String(route)} accessibilityRole="button" style={styles.actionRow} onPress={() => router.push(route)}>
        <Icon size={21} color={colors.textSecondary} strokeWidth={1.7} /><Text style={styles.actionText}>{label}</Text>
        {route === '/alerts' && unread > 0 && <Text style={styles.caption}>{t('home.unread', { count: unread })}</Text>}
        <ChevronRight size={19} color={colors.textSecondary} />
      </TouchableOpacity>)}
    </ScrollView>
    {/* Floats over the page, clear of the tab bar. Waits for the farm and zone
        data so the greeting never lands on a half-drawn screen, and renders
        nothing when the farmer has the helper switched off. */}
    <DripHelper
      zones={zones.map(z => ({ id: z.id, name: z.name }))}
      unreadAlertCount={unread}
      ready={!isFarmLoading && !isZonesLoading && !!farm}
    />
  </SafeAreaView>;
}
