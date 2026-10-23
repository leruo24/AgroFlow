import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { router } from '@/lib/router';
import { Bell, ChevronRight, Clock3, CloudSun, Container, Droplets, FileText, Settings2, Users } from 'lucide-react-native';
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
import { WhereYouAreNow } from '@/components/WhereYouAreNow';
import { AutoOfferCard } from '@/components/AutoOfferCard';
import { useJourney } from '@/hooks/useJourney';
import { DroughtCard } from '@/components/DroughtCard';
import { CardList } from '@/components/ui/Card';
import { InfoGrid } from '@/components/ui/InfoGrid';
import { useBottomPadding } from '@/hooks/useScreenPadding';
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
  const moistureText = averageSoilText(zones.map(z => z.sensors.soilMoisture));
  const moisture = moistureText === 'No reading' ? t('empty.noReading') : moistureText;
  const bottom = useBottomPadding();
  const unread = alerts.filter(a => !a.read).length;
  const journey = useJourney();
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
  // Kept with the farm it belongs to (AF-22): another farm's tank is never shown, and until this
  // farm's answer arrives the card says Loading, not "not set up".
  const [tankFor, setTankFor] = useState<{ farmId: string; status: TankStatus } | null>(null);
  const [tankFailed, setTankFailed] = useState(false);
  const tank = tankFor && farm && tankFor.farmId === farm.id ? tankFor.status : null;
  const tankLoading = !!farm && !tank && !tankFailed;
  const loadTank = useCallback(() => {
    if (!farm) return;
    const farmId = farm.id;
    fetchTankStatus(farmId).then(value => { setTankFor({ farmId, status: value }); setTankFailed(false); }).catch(() => setTankFailed(true));
  }, [farm]);
  useFocusEffect(loadTank);
  // Back online: swap the saved copies for live ones.
  useEffect(() => onReconnect(() => { loadToday(); loadTank(); }), [loadToday, loadTank]);
  const pendingCommands = zones.filter(z => z.irrigation.override.active).length;
  // null usedTodayLitres means the zone has no zone_daily_water_usage row today,
  // so we only add up zones that have one instead of showing a false 0.
  const zonesWithUsage = zones.filter(z => z.water.usedTodayLitres != null);
  const waterToday = zonesWithUsage.length === 0
    ? t('empty.noWaterToday')
    : Math.round(zonesWithUsage.reduce((sum, z) => sum + z.water.usedTodayLitres!, 0)) + ' L';
  const metrics = [
    { label: t('home.metricMoisture'), value: moisture },
    // There is no valve feedback: this counts runs sent to a kit. With no kit, there is nothing to count.
    { label: t('home.metricIrrigating'), value: zones.some(z => z.sensors.soilMoisture.status === 'Online' || z.sensors.temperatureHumidity.status === 'Online')
      ? String(zones.filter(z => z.irrigation.override.active).length) : t('empty.noKit') },
    { label: t('home.metricWater'), value: waterToday },
    // Not a false 0 while the zones and alerts are still loading (AF-22).
    { label: t('home.metricAlerts'), value: isZonesLoading ? '—' : String(unread) },
  ];
  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
      <ScreenHeader title="AgroFlow" subtitle={t('home.subtitle')} help="home" />
      <FarmSelector />
      {isFarmLoading ? <DataState kind="loading" title={t('home.loadingFarm')} />
        : farmError ? <DataState kind="error" title={t('home.farmUnavailable')} description={t('home.farmUnavailableBody')} onRetry={refreshFarms} />
        : !farm ? <DataState kind="empty" title={t('home.noFarm')} description={t('home.noFarmBody')} />
        : <>
          {/* Where you are now (B3-03): the stage, the next action, who acts next and the date,
              with "Your details: X of 4" and "Installation: <stage>". Before migration 0058 the
              old setup card shows instead. Then "Turn on automatic watering?" for a zone the
              installer has just commissioned. */}
          <WhereYouAreNow state={journey} />
          {journey.status === 'ready' ? <AutoOfferCard journey={journey.journey} onAnswered={journey.reload} /> : null}
          {/* The water budget, and drought mode with each zone's priority when it is on. */}
          <DroughtCard />
          {/* Today next: it is what a farmer opens the app to find out. */}
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.today')}</Text>
          {todayFailed ? <DataState kind="error" title={t('home.todayUnavailable')} onRetry={loadToday} />
            : today === null ? <DataState kind="loading" title={t('home.todayLoading')} />
            : today.length === 0 ? <DataState kind="empty" title={t('home.noZones')} description={t('home.noZonesToday')} />
            : <CardList>{today.map(z => <TodayCard key={z.zoneId} zone={z} onLogged={loadToday} />)}</CardList>}
          <FarmLocationMap key={farm.id} farm={farm} />
          <WeatherSummary key={farm.id + '-' + farm.latitude + '-' + farm.longitude} farm={farm} />
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('home.tank')}</Text>
          {tankFailed ? <DataState kind="error" title={t('home.tankUnavailable')} onRetry={loadTank} />
            : <View style={styles.tankCard}>
              <Text style={styles.tankEstimate} testID="home-tank-estimate">{tankLoading ? t('common.loading')
                : tank?.estimatedRemainingLitres != null
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
              <View style={styles.metrics}><InfoGrid testID="home-metrics" items={metrics.map(m => ({ ...m, muted: !/^\d/.test(m.value) }))} /></View>
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
        { label: t('home.community'), route: '/community' as never, Icon: Users },
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
