// The Kit tab: one card per zone. At the top a plain status (Working, Needs attention, Not
// connected, or Awaiting installation for a zone with no kit yet), then a checklist of what is
// working. Every line is the server's reading of what the kit really reports (KitHealth): never a
// battery level, water flow or valve position, which the kit cannot measure. Below it, the kit's
// setup Wi-Fi with a copy button, and Change Wi-Fi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleAlert, CircleCheck, CircleX, Info } from 'lucide-react-native';
import { router } from '@/lib/router';
import { FarmSelector } from '@/components/FarmSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { Card, CardList } from '@/components/ui/Card';
import { InfoGrid } from '@/components/ui/InfoGrid';
import { useAgroFlow, type IrrigationMode, type Zone } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { useI18n, type TranslationKey } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { createScreenStyles } from '@/styles/screenStyles';
import { createIrrigationStyles } from '@/styles/irrigationStyles';
import { copyOrShare, kitLineText } from '@/lib/kitStatus';
import { KitHelpGuide } from '@/components/KitHelpGuide';
import {
  ApiHttpError,
  fetchFarmKits,
  fetchZoneCommands,
  issueFarmerKitCode,
  sendManualIrrigationCommand,
  type CommandPhase,
  type CommandStatus,
  type FarmerKitCode,
  type KitCard,
  type KitLine,
} from '@/services/agroFlowApi';
import { formatSast } from '@/lib/sastTime';
import type { AppColors } from '@/constants/colors';
import { AppAlert as Alert } from '@/components/AppAlert';
import { CommandPhaseLabel } from '@/components/visual/CommandPhaseLabel';
import { useRunStatus } from '@/hooks/useRunStatus';
import { useConnectivity } from '@/lib/connectivity';
import { effectiveRunMinutes } from '@/lib/schedule';
import { defaultRunMinutes, zoneMaxRunMinutes } from '@/lib/runLimit';
import { soilReadingText } from '@/lib/moistureDisplay';

type State =
  | { status: 'loading' }
  | { status: 'ready'; cards: KitCard[] }
  | { status: 'error'; cards: KitCard[] | null };

export default function KitTabScreen() {
  const { farm, zones, refreshZones, updateIrrigationMode } = useAgroFlow();
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const bottom = useBottomPadding();
  const styles = useMemo(() => kitStyles(colors), [colors]);
  const params = useLocalSearchParams<{ zone?: string }>();
  const focusZone = Number(params.zone) || null;
  const farmId = farm?.id ?? null;
  const [state, setState] = useState<{ farmId: string | null; value: State }>({ farmId: null, value: { status: 'loading' } });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!farmId) return;
    try {
      const cards = await fetchFarmKits(farmId);
      setState({ farmId, value: { status: 'ready', cards } });
    } catch {
      // Keep what was there (it is still the last real answer), and say the refresh failed.
      setState(current => ({ farmId, value: { status: 'error', cards: current.farmId === farmId && current.value.status !== 'loading' ? current.value.cards : null } }));
    }
  }, [farmId]);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    refreshZones();
    await load();
    setRefreshing(false);
  }, [load, refreshZones]);

  const value: State = state.farmId === farmId ? state.value : { status: 'loading' };
  const cards = value.status === 'loading' ? null : value.cards;

  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} testID="kit-tab"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={colors.primaryDark} />}>
      <ScreenHeader title={t('kitTab.title')} subtitle={t('kitTab.intro')} />
      <FarmSelector />
      {!farm || value.status === 'loading'
        ? <DataState kind="loading" title={t('kitTab.loading')} />
        : value.status === 'error' && !cards
          ? <DataState kind="error" title={t('kitTab.error')} description={t('kitTab.errorBody')} onRetry={() => { void load(); }} />
          : <>
            {value.status === 'error' ? <DataState kind="stale" title={t('kitTab.error')} description={t('kitTab.errorBody')} onRetry={() => { void load(); }} /> : null}
            {cards && cards.length === 0
              ? <DataState kind="empty" title={t('kitTab.noZones')} description={t('kitTab.noZonesBody')} />
              : <CardList>{(cards ?? []).map(card =>
                <KitCardView key={card.zoneId} card={card} zone={(zones ?? []).find(zone => Number(zone.id) === card.zoneId) ?? null}
                  focused={card.zoneId === focusZone} colors={colors} styles={styles} t={t} lang={lang}
                  updateIrrigationMode={updateIrrigationMode} reload={load} />)}</CardList>}
          </>}
    </ScrollView>
  </SafeAreaView>;
}

type T = ReturnType<typeof useI18n>['t'];
// The shared screen styles plus the Irrigation tab's buttons.
const kitStyles = (colors: AppColors) => ({
  ...createScreenStyles(colors),
  ...createIrrigationStyles(colors),
  controlPanel: { marginTop: 16, gap: 12, padding: 16, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  modeRow: { flexDirection: 'row' as const, gap: 8 },
  modeButton: { flex: 1, minHeight: 48, alignItems: 'center' as const, justifyContent: 'center' as const,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modeButtonSelected: { backgroundColor: colors.action, borderColor: colors.action },
  modeText: { color: colors.text, fontSize: 16, fontWeight: '600' as const },
  modeTextSelected: { color: colors.white },
  durationInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 12, backgroundColor: colors.surface, color: colors.text, fontSize: 18 },
  startButton: { minHeight: 58, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: colors.success },
  stopButton: { minHeight: 58, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: colors.dangerAction },
  controlButtonText: { color: colors.white, fontSize: 18, fontWeight: '800' as const },
  disabledButton: { opacity: 0.55 },
});
type Styles = ReturnType<typeof kitStyles>;

function toneColor(colors: AppColors, tone: KitLine['tone'] | 'neutral') {
  return tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning : tone === 'bad' ? colors.error : colors.textSecondary;
}

function KitCardView({ card, zone, focused, colors, styles, t, lang, updateIrrigationMode, reload }: {
  card: KitCard;
  zone: Zone | null;
  focused: boolean;
  colors: AppColors;
  styles: Styles;
  t: T;
  lang: ReturnType<typeof useI18n>['lang'];
  updateIrrigationMode: (zoneId: string, mode: IrrigationMode) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [whenOpen, setWhenOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<FarmerKitCode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [confirmingEnrollment, setConfirmingEnrollment] = useState(false);
  const { online: phoneOnline } = useConnectivity();
  const connectionLine = card.lines.find(line => line.key === 'connection');
  const kitOnline = connectionLine?.state === 'online';
  const maxRunMinutes = zoneMaxRunMinutes(zone?.maxRunMinutes);
  const [manualDuration, setManualDuration] = useState(String(defaultRunMinutes(maxRunMinutes)));
  const [latestCommand, setLatestCommand] = useState<CommandStatus | null>(null);
  const [trackedCommand, setTrackedCommand] = useState<{ id: string; command: 'start' | 'stop'; seconds: number } | null>(null);
  const [lastPhase, setLastPhase] = useState<CommandPhase | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const runStatus = useRunStatus(trackedCommand?.id ?? null, trackedCommand?.seconds ?? 0);

  const loadLatestCommand = useCallback(async () => {
    if (!card.hasKit) return;
    try {
      const commands = await fetchZoneCommands(card.zoneId, 1);
      setLatestCommand(commands[0] ?? null);
    } catch {
      // The kit card itself still has independently loaded connection/sensor facts. A command
      // history failure must not turn those facts into an apparent kit failure.
    }
  }, [card.hasKit, card.zoneId]);

  useEffect(() => { void loadLatestCommand(); }, [loadLatestCommand]);
  useEffect(() => {
    setManualDuration(current => Number(current) > maxRunMinutes ? String(defaultRunMinutes(maxRunMinutes)) : current);
  }, [maxRunMinutes]);
  useEffect(() => {
    if (!runStatus?.phase) return;
    setLastPhase(runStatus.phase);
    if (runStatus.phase === 'kit_confirmed_start' || runStatus.phase === 'kit_confirmed_stop' || runStatus.phase === 'finished') {
      void loadLatestCommand();
      void reload();
    }
  }, [loadLatestCommand, reload, runStatus?.phase]);

  // lastPhase changes immediately when a new command is accepted. Prefer it over the hook's
  // previous-command value during the one render before useRunStatus resets for the new id.
  const displayedPhase = lastPhase ?? runStatus?.phase ?? latestCommand?.phase ?? null;
  const displayedState = runStatus?.state ?? latestCommand?.state ?? null;
  const displayedCommand = trackedCommand?.command ?? latestCommand?.command ?? null;
  const startStillUnresolved = displayedCommand === 'start' && displayedState !== 'finished' && displayedState !== 'failed'
    && displayedPhase !== 'kit_confirmed_stop';
  const stopStillUnresolved = displayedCommand === 'stop' && displayedPhase !== 'kit_confirmed_stop'
    && displayedState !== 'failed';
  const showStop = startStillUnresolved || stopStillUnresolved;
  const controlsDisabled = commandBusy || !phoneOnline || !kitOnline;
  // Awaiting installation is not a fault: no red, a plain next step.
  const tone = card.overall === 'working' ? 'ok' : card.overall === 'needs_attention' ? 'warn' : card.overall === 'not_connected' ? 'bad' : 'neutral';
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? CircleAlert : tone === 'bad' ? CircleX : Info;
  const copyLabel = Platform.OS === 'web' ? t('kitTab.copy') : t('kitTab.copyOrShare');
  const copy = async (what: string, text: string) => {
    const result = await copyOrShare(text);
    if (result === 'copied') { setCopied(what); setTimeout(() => setCopied(null), 2000); }
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setEnrollmentError(null);
    try {
      setEnrollment(await issueFarmerKitCode(card.zoneId));
    } catch (error) {
      setEnrollmentError(error instanceof Error ? error.message : t('kitTab.enrollFailed'));
    } finally {
      setGenerating(false);
      setConfirmingEnrollment(false);
    }
  };

  const commandErrorText = (error: unknown) => {
    if (error instanceof ApiHttpError && error.status === 409) {
      return error.message.startsWith('No kit connected to this zone:') ? t('zone.kitOffline') : t('zone.noKit');
    }
    return error instanceof Error && error.message ? error.message : t('zone.commandFailed');
  };

  const sendCommand = async (command: 'start' | 'stop', seconds?: number) => {
    if (commandBusy) return;
    if (!phoneOnline) { setCommandError(t('offline.needsConnection')); return; }
    if (!kitOnline) { setCommandError(t('zone.kitOffline')); return; }
    setCommandBusy(true);
    setCommandError(null);
    try {
      const sent = await sendManualIrrigationCommand(String(card.zoneId), command, seconds);
      const effectiveSeconds = sent.durationSeconds ?? seconds ?? 0;
      setTrackedCommand({ id: sent.id, command, seconds: effectiveSeconds });
      setLastPhase(command === 'start' ? 'request_sent' : 'stop_requested');
      await reload();
    } catch (error) {
      setCommandError(commandErrorText(error));
    } finally {
      setCommandBusy(false);
    }
  };

  const startIrrigation = () => {
    const requested = Number(manualDuration);
    if (!Number.isFinite(requested) || requested < 1) {
      Alert.alert(t('zone.invalidDurationTitle'), t('zone.invalidDuration', { max: maxRunMinutes }));
      return;
    }
    const run = effectiveRunMinutes(requested, maxRunMinutes);
    Alert.alert(
      t('zone.startConfirmTitle', { zone: card.zoneName }),
      `${t('zone.startConfirmBody', { minutes: run.minutes })}${run.capped ? `\n${t('run.capped', { max: run.max })}` : ''}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('zone.start'), onPress: () => { void sendCommand('start', run.minutes * 60); } },
      ]
    );
  };

  const stopIrrigation = () => {
    Alert.alert(
      t('zone.stopConfirmTitle', { zone: card.zoneName }),
      t('zone.stopConfirmBody', { mode: t('zone.modeManual').toLowerCase() }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('zone.stop'), style: 'destructive', onPress: () => { void sendCommand('stop'); } },
      ]
    );
  };

  const chooseMode = async (mode: IrrigationMode) => {
    if (!zone || modeBusy || zone.irrigation.mode === mode) return;
    setModeBusy(true);
    setCommandError(null);
    try {
      await updateIrrigationMode(zone.id, mode);
    } catch (error) {
      setCommandError(commandErrorText(error));
    } finally {
      setModeBusy(false);
    }
  };

  return <Card testID={`kit-card-${card.zoneId}`} style={focused ? { borderColor: colors.action, borderWidth: 2 } : undefined}>
    <Text accessibilityRole="header" style={styles.title}>{card.zoneName}</Text>
    {card.deviceName ? <Text style={styles.caption}>{card.deviceName}</Text> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }} accessibilityLiveRegion="polite">
      <Icon size={22} color={toneColor(colors, tone)} strokeWidth={2} />
      <Text style={[styles.body, { fontWeight: '700', color: toneColor(colors, tone) }]} testID={`kit-overall-${card.zoneId}`}>
        {t(`kitTab.overall.${card.overall}` as TranslationKey)}
      </Text>
    </View>

    {!card.hasKit
      ? <View style={{ marginTop: 8, gap: 12 }}>
        <Text style={styles.body} testID={`kit-awaiting-${card.zoneId}`}>{t('kitTab.awaitingBody')}</Text>
        {enrollment ? <View
          style={{ gap: 8, padding: 16, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: 'center' }}
          accessibilityLiveRegion="polite"
          testID={`kit-enrollment-${card.zoneId}`}
        >
          <Text style={[styles.body, { fontWeight: '700' }]}>{t('kitTab.codeLabel')}</Text>
          <Text selectable style={{ color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '800', letterSpacing: 8 }}
            testID={`kit-enrollment-code-${card.zoneId}`}>{enrollment.code}</Text>
          <Text style={styles.caption} testID={`kit-enrollment-expiry-${card.zoneId}`}>
            {t('kitTab.codeExpiry', { time: formatSast(enrollment.expiresAt) ?? enrollment.expiresAt })}
          </Text>
          <Text style={[styles.body, { textAlign: 'center' }]}>{t('kitTab.codeSteps')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('kitTab.copyCode')}
            onPress={() => { void copy('enrollment', enrollment.code); }} style={styles.secondaryButton}
            testID={`kit-copy-code-${card.zoneId}`}>
            <Text style={styles.buttonText}>{copied === 'enrollment' ? t('kitTab.copied') : copyLabel}</Text>
          </Pressable>
        </View> : null}
        {enrollmentError ? <Text style={{ color: colors.error }} accessibilityLiveRegion="assertive"
          testID={`kit-enrollment-error-${card.zoneId}`}>{enrollmentError}</Text> : null}
        {confirmingEnrollment ? <View style={{ gap: 8 }} testID={`kit-enrollment-confirm-${card.zoneId}`}>
          <Text style={[styles.body, { fontWeight: '700' }]}>{t('kitTab.addTitle', { zone: card.zoneName })}</Text>
          <Text style={styles.caption}>{t('kitTab.addWarning')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable accessibilityRole="button" disabled={generating} onPress={() => setConfirmingEnrollment(false)}
              style={[styles.secondaryButton, { flex: 1 }]} testID={`kit-add-cancel-${card.zoneId}`}>
              <Text style={styles.buttonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: generating }} disabled={generating}
              onPress={() => { void generate(); }} style={[styles.secondaryButton, { flex: 1 }, generating && { opacity: 0.6 }]}
              testID={`kit-add-confirm-${card.zoneId}`}>
              {generating
                ? <ActivityIndicator color={colors.primaryDark} />
                : <Text style={styles.buttonText}>{enrollment ? t('kitTab.generateAgain') : t('kitTab.add')}</Text>}
            </Pressable>
          </View>
        </View> : <Pressable accessibilityRole="button" onPress={() => setConfirmingEnrollment(true)}
          style={styles.secondaryButton} testID={`kit-add-${card.zoneId}`}>
          <Text style={styles.buttonText}>{enrollment ? t('kitTab.generateAgain') : t('kitTab.add')}</Text>
        </Pressable>}
      </View>
      : <>
        <View style={{ marginTop: 12, gap: 8 }} accessibilityRole="list">
          {card.lines.map(line => {
            const LineIcon = line.tone === 'ok' ? CircleCheck : line.tone === 'warn' ? CircleAlert : line.tone === 'bad' ? CircleX : Info;
            return <View key={line.key} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }} testID={`kit-line-${card.zoneId}-${line.key}`}>
              <LineIcon size={18} color={toneColor(colors, line.tone)} strokeWidth={2} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.body} testID={`kit-line-text-${card.zoneId}-${line.key}`}>{kitLineText(lang, line)}</Text>
                {line.key === 'pump' && line.state !== 'never' ? <Text style={styles.caption}>{t('kitTab.pumpNote')}</Text> : null}
              </View>
            </View>;
          })}
        </View>

        <View style={styles.controlPanel} testID={`kit-controls-${card.zoneId}`}>
          <Text accessibilityRole="header" style={[styles.title, { fontSize: 19 }]}>{t('zone.irrigationControl')}</Text>
          {zone ? <InfoGrid items={[
            { label: t('zone.soilMoisture'), value: soilReadingText(zone.sensors.soilMoisture, t('empty.noReading')),
              muted: zone.sensors.soilMoisture.status !== 'Online' },
            { label: t('sensor.temperature'), value: zone.sensors.temperatureHumidity.status === 'Online'
              ? `${zone.sensors.temperatureHumidity.temperature}${zone.sensors.temperatureHumidity.temperatureUnit}` : t('empty.noReading'),
              muted: zone.sensors.temperatureHumidity.status !== 'Online' },
            { label: t('zone.humidity'), value: zone.sensors.temperatureHumidity.status === 'Online'
              ? `${zone.sensors.temperatureHumidity.humidity}${zone.sensors.temperatureHumidity.humidityUnit}` : t('empty.noReading'),
              muted: zone.sensors.temperatureHumidity.status !== 'Online' },
            { label: t('zone.relay'), value: displayedPhase
              ? t(`visual.phase.${displayedPhase}` as TranslationKey)
              : kitLineText(lang, card.lines.find(line => line.key === 'pump') ?? { key: 'pump', state: 'never', tone: 'info', at: null, value: null }) },
          ]} /> : <Text style={styles.caption}>{t('empty.noReading')}</Text>}

          {zone ? <>
            <Text style={[styles.body, { fontWeight: '700' }]}>{t('zone.irrigationMode')}</Text>
            <View style={styles.modeRow}>
              {(['manual', 'automatic'] as const).map(mode => {
                const selected = zone.irrigation.mode === mode;
                return <Pressable key={mode} accessibilityRole="button" accessibilityState={{ selected, disabled: modeBusy }}
                  disabled={modeBusy} onPress={() => { void chooseMode(mode); }}
                  style={[styles.modeButton, selected && styles.modeButtonSelected]} testID={`kit-mode-${card.zoneId}-${mode}`}>
                  <Text style={[styles.modeText, selected && styles.modeTextSelected]}>
                    {t(mode === 'manual' ? 'zone.modeManual' : 'zone.modeAutomatic')}
                  </Text>
                </Pressable>;
              })}
            </View>
          </> : null}

          {!showStop ? <>
            <Text style={[styles.body, { fontWeight: '700' }]}>{t('zone.duration')}</Text>
            <TextInput value={manualDuration} onChangeText={setManualDuration} keyboardType="number-pad" maxLength={4}
              editable={!commandBusy} style={styles.durationInput} testID={`kit-duration-${card.zoneId}`}
              accessibilityLabel={t('zone.duration')} />
          </> : null}

          <Pressable accessibilityRole="button" accessibilityState={{ disabled: controlsDisabled }} disabled={controlsDisabled}
            onPress={showStop ? stopIrrigation : startIrrigation}
            style={[showStop ? styles.stopButton : styles.startButton, controlsDisabled && styles.disabledButton]}
            testID={`kit-irrigate-${card.zoneId}`}>
            {commandBusy ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.controlButtonText}>{t(showStop ? 'kitTab.stopIrrigation' : 'kitTab.startIrrigation')}</Text>}
          </Pressable>

          {displayedPhase ? <CommandPhaseLabel phase={displayedPhase} testID={`kit-command-phase-${card.zoneId}`} /> : null}
          {!phoneOnline ? <Text style={[styles.caption, { color: colors.warning }]}>{t('offline.needsConnection')}</Text> : null}
          {phoneOnline && !kitOnline ? <Text style={[styles.caption, { color: colors.warning }]}>{t('zone.kitOffline')}</Text> : null}
          {commandError ? <Text style={{ color: colors.error }} accessibilityLiveRegion="assertive"
            testID={`kit-command-error-${card.zoneId}`}>{commandError}</Text> : null}
          <Text style={styles.caption}>{t('kitTab.pumpNote')}</Text>
        </View>

        {/* The setup Wi-Fi: always shown, online or not, because it is needed exactly when the
            kit cannot reach the internet. */}
        <View style={{ marginTop: 16, gap: 8 }} testID={`kit-setup-wifi-${card.zoneId}`}>
          {card.setupNetworkName && card.setupNetworkPassword ? <>
            <Text selectable style={styles.body} testID={`kit-setup-wifi-text-${card.zoneId}`}>
              {t('kitTab.setupWifi', { name: card.setupNetworkName, password: card.setupNetworkPassword })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('kitTab.copyName')} onPress={() => { void copy('name', card.setupNetworkName!); }}
                style={styles.secondaryButton} testID={`kit-copy-name-${card.zoneId}`}>
                <Text style={styles.buttonText}>{copied === 'name' ? t('kitTab.copied') : `${copyLabel}: ${t('kitTab.setupWifiLabel')}`}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('kitTab.copyPassword')} onPress={() => { void copy('password', card.setupNetworkPassword!); }}
                style={styles.secondaryButton} testID={`kit-copy-password-${card.zoneId}`}>
                <Text style={styles.buttonText}>{copied === 'password' ? t('kitTab.copied') : `${copyLabel}: ${t('kitTab.passwordLabel')}`}</Text>
              </Pressable>
            </View>
          </> : <Text style={styles.caption}>{t('kitTab.noSetupWifi')}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: whenOpen }} onPress={() => setWhenOpen(v => !v)} style={{ minHeight: 44, justifyContent: 'center' }}
            testID={`kit-when-${card.zoneId}`}>
            <Text style={[styles.body, { color: colors.primaryDark, fontWeight: '600' }]}>{t('kitTab.whenNeeded')}</Text>
          </Pressable>
          {whenOpen ? <Text style={styles.caption}>{t('kitTab.whenNeededBody')}</Text> : null}
        </View>

        <Pressable accessibilityRole="button" style={[styles.secondaryButton, { marginTop: 8 }]} testID={`kit-change-wifi-${card.zoneId}`}
          onPress={() => router.push({ pathname: '/zone-hardware', params: { zoneId: String(card.zoneId), zoneName: card.zoneName } } as never)}>
          <Text style={styles.buttonText}>{t('kitTab.changeWifi')}</Text>
        </Pressable>
        <KitHelpGuide networkName={card.setupNetworkName} password={card.setupNetworkPassword} testID={`kit-help-${card.zoneId}`} />
      </>}
  </Card>;
}
