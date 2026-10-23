// Your details: four short tasks (B3-02), replacing the 17-step wizard.
//   /setup                                   the four tasks, "Your details: X of 4", "Installation: <stage>"
//   /setup?task=water&screen=tank            one screen; the URL always says which (AF-08)
//   /setup?task=preferences&screen=alerts&from=settings   opened from Settings: Back and Save return there
//   /setup?step=alerts                       the old links still open the screen that now holds the step
// Every screen has one "Save and continue". It saves first and moves on exactly once, only after
// the save succeeded; a failed save keeps what was typed and stays; a second press while saving
// does nothing. Back keeps what was typed. Finishing a task is the server's record
// (POST /api/farmer/farms/{id}/tasks/{task}), checked against the saved data. Any question can be
// answered "I don't know – help me", which sends AgroFlow staff a follow-up instead of blocking.
// Installer work (flow, calibration, kit, run limit, test) is shown as "Your installer will
// complete this". Outside the tab group, so the tab bar is hidden while it is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { Radius, Spacing, Type, type AppColors, Space, Layout } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { LANGUAGES, useI18n, type TranslationKey } from '@/i18n';
import { TelegramSection } from '@/components/TelegramSection';
import FarmMapSurface from '@/components/FarmMapSurface';
import { useAppPreferences } from '@/hooks/useAppPreferences';
import { useSetup } from '@/hooks/useSetup';
import { useJourney } from '@/hooks/useJourney';
import {
  ApiHttpError, DEFAULT_PREFERENCES, acceptTerms, askForHelp, changeZoneCrop, fetchNotificationPreferences, finishFarmerTask,
  logTankRefill, reportLocationProblem, saveIrrigationType, saveNotificationPreferences, saveTankCapacity, saveWaterSource,
  saveZoneSetup, saveZoneSoilType, type FarmerTaskKey, type HelpTopic, type Journey, type NotificationPreferences,
} from '@/services/agroFlowApi';
import { isNetworkError } from '@/lib/connectivity';
import { ZONE_CROPS, dayLabel, plantedWeeksAgo } from '@/lib/setupHelpers';
import { IRRIGATION_TYPES, SOIL_TYPES, TANK_LEVELS, TANK_SIZES, WATER_SOURCES, areaToM2, confirm, soilTypeKey, tankLitres } from '@/lib/setupProgress';
import {
  FARMER_TASKS, backTarget, isTask, nextScreen, nextTask, screenFromParam, screensFor, taskOf,
  type ScreenFacts, type ScreenKey,
} from '@/lib/farmerTasks';
import { formatAreaM2 } from '@/lib/area';
import { formatSast } from '@/lib/sastTime';
import { useBottomPadding } from '@/hooks/useScreenPadding';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

// What a screen's save answers. missing: a required answer is not given; "I don't know – help me"
// on that screen makes it acceptable.
export type SaveResult = { ok: true } | { ok: false; error: string; missing?: boolean };
type SaveFn = () => Promise<SaveResult>;
type Position = { task: FarmerTaskKey; screen: ScreenKey } | 'hub';

const HELP_TOPIC: Partial<Record<ScreenKey, HelpTopic>> = { location: 'location', water: 'water_source', tank: 'tank_capacity' };

export default function SetupScreen() {
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ task?: string; screen?: string; step?: string; from?: string }>();
  const from = params.from === 'settings' ? 'settings' : null;
  const { farm } = useAgroFlow();
  const { mustChangePassword } = useAuth();
  const setup = useSetup();
  const journey = useJourney();

  // Drafts keep what was typed on each screen while the farmer moves Back and forth.
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const draftFor = useCallback(<V,>(key: string, fallback: V) => (key in drafts ? drafts[key] as V : fallback), [drafts]);
  const setDraft = useCallback((key: string, value: unknown) => setDrafts(d => ({ ...d, [key]: value })), []);

  const facts: ScreenFacts = {
    mustChangePassword,
    waterSource: (drafts['water'] as string | undefined) ?? setup.farmSetup?.farm?.waterSource ?? null,
  };

  // Where the farmer is: from the URL first, so a reload or a link lands on the same screen.
  const [position, setPosition] = useState<Position | null>(null);
  const openedAt = useRef<ScreenKey | null>(null);
  useEffect(() => {
    if (position) return;
    const screen = screenFromParam(params.screen ?? params.step);
    if (screen) { openedAt.current = screen; setPosition({ task: isTask(params.task) ? params.task : taskOf(screen), screen }); return; }
    if (isTask(params.task)) { setPosition({ task: params.task, screen: screensFor(params.task, facts)[0] }); return; }
    // Still on the temporary password: that comes first, before anything else (security).
    if (mustChangePassword) { setPosition({ task: 'preferences', screen: 'password' }); return; }
    setPosition('hub');
  }, [position, params.screen, params.step, params.task]); // eslint-disable-line react-hooks/exhaustive-deps

  // The URL always matches the screen shown (AF-08).
  useEffect(() => {
    if (!position) return;
    if (position === 'hub') router.setParams({ task: undefined, screen: undefined, step: undefined } as never);
    else router.setParams({ task: position.task, screen: position.screen, step: undefined } as never);
  }, [position]);

  const saveRef = useRef<SaveFn | null>(null);
  const register = useCallback((fn: SaveFn | null) => { saveRef.current = fn; }, []);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helped, setHelped] = useState<Record<string, string>>({});

  const go = (p: Position) => { setError(null); saveRef.current = null; setPosition(p); };

  const leaveToSettings = () => (router.canGoBack() ? router.back() : router.replace('/settings' as never));

  const saveAndContinue = async () => {
    if (busy.current || !position || position === 'hub') return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const result = saveRef.current ? await saveRef.current() : { ok: true as const };
      if (!result.ok && !(result.missing && helped[position.screen])) { setError(result.error); return; }
      // Opened from Settings: saved, so back to Settings, never on to unrelated steps.
      if (from === 'settings') { leaveToSettings(); return; }
      const next = nextScreen(position.task, position.screen, facts);
      if (next) { go({ task: position.task, screen: next }); return; }
      // The last screen: the task is finished only when the server agrees.
      if (farm) {
        try {
          journey.setJourney(await finishFarmerTask(farm.id, position.task));
        } catch (e) {
          if (!(e instanceof ApiHttpError && e.status === 409)) { setError(errorText(t, e)); return; }
        }
      }
      go('hub');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      busy.current = false; setSaving(false);
    }
  };

  const back = () => {
    if (!position || position === 'hub') { if (router.canGoBack()) router.back(); else router.replace('/' as never); return; }
    const target = backTarget(position.task, position.screen, facts, from, openedAt.current);
    if (target.kind === 'settings') leaveToSettings();
    else if (target.kind === 'hub') go('hub');
    else go({ task: position.task, screen: target.screen });
  };

  const help = async (topic: HelpTopic, zoneId?: number) => {
    if (!farm || !position || position === 'hub') return;
    try {
      const r = await askForHelp(farm.id, topic, zoneId);
      setHelped(h => ({ ...h, [zoneId ? `${position.screen}:${zoneId}` : position.screen]: r.message }));
      if (!zoneId) setHelped(h => ({ ...h, [position.screen]: r.message }));
      journey.reload();
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  if (!position || !setup.ready) {
    return <SafeAreaView style={styles.page}><ActivityIndicator style={{ marginTop: 80 }} color={colors.primaryDark} accessibilityLabel={t('common.loading')} /></SafeAreaView>;
  }

  if (position === 'hub') {
    return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.frame}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} testID="setup-hub">
          <Hub t={t} styles={styles} journey={journey.journey} loading={journey.status === 'loading'}
            onOpen={task => go(mustChangePassword ? { task: 'preferences', screen: 'password' } : { task, screen: screensFor(task, facts)[0] })} />
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={back} style={styles.secondary} testID="setup-back">
            <Text style={styles.secondaryText}>{t('setup.back')}</Text>
          </Pressable>
          {(() => {
            const done = journey.journey?.setupProgress.tasks.filter(x => x.done).map(x => x.key) ?? [];
            const next = journey.status === 'ready' ? nextTask(done) : null;
            return next
              ? <Pressable accessibilityRole="button" onPress={() => go({ task: next, screen: screensFor(next, facts)[0] })} style={styles.primary} testID="setup-next-task">
                  <Text style={styles.primaryText}>{t('tasks.start', { task: t(`tasks.${next}` as TranslationKey) })}</Text>
                </Pressable>
              : <Pressable accessibilityRole="button" onPress={() => router.replace('/' as never)} style={styles.primary} testID="setup-go">
                  <Text style={styles.primaryText}>{t('setup.done.go')}</Text>
                </Pressable>;
          })()}
        </View>
      </View>
    </SafeAreaView>;
  }

  const list = screensFor(position.task, facts);
  const n = list.indexOf(position.screen) + 1;
  const topic = HELP_TOPIC[position.screen];
  const props: ScreenProps = { t, styles, register, draftFor, setDraft, setup, journey: journey.journey, help, helped, screen: position.screen };

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.frame}>
      <View style={styles.progressHead} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: list.length, now: n }}
        accessibilityLabel={t('tasks.progress', { task: t(`tasks.${position.task}` as TranslationKey), n, of: list.length })}>
        <Text style={styles.progressText} testID="setup-progress">
          {t('tasks.progress', { task: t(`tasks.${position.task}` as TranslationKey), n, of: list.length })}
        </Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(n / list.length) * 100}%` }]} /></View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} keyboardShouldPersistTaps="handled" testID={`setup-screen-${position.screen}`}>
        <ScreenBody {...props} />
        {topic ? <HelpLink t={t} styles={styles} sent={helped[position.screen]} onPress={() => { void help(topic); }} testID={`setup-help-${position.screen}`} /> : null}
      </ScrollView>
      {error ? <Text style={[styles.error, styles.footerError]} accessibilityLiveRegion="assertive" testID="setup-error">{error}</Text> : null}
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={back} style={styles.secondary} testID="setup-back">
          <Text style={styles.secondaryText}>{t('setup.back')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
          onPress={() => { void saveAndContinue(); }} style={[styles.primary, saving && styles.disabled]} testID="setup-save">
          {saving ? <ActivityIndicator color={colors.white} accessibilityLabel={t('common.saving')} />
            : <Text style={styles.primaryText}>{from === 'settings' ? t('tasks.saveReturn') : t('tasks.saveContinue')}</Text>}
        </Pressable>
      </View>
    </View>
  </SafeAreaView>;
}

function errorText(t: T, e: unknown): string {
  if (isNetworkError(e)) return t('tasks.saveOffline');
  return e instanceof Error && e.message ? e.message : t('tasks.saveFailed');
}

type Styles = ReturnType<typeof createStyles>;
type ScreenProps = {
  t: T; styles: Styles; screen: ScreenKey;
  register: (fn: SaveFn | null) => void;
  draftFor: <V>(key: string, fallback: V) => V;
  setDraft: (key: string, value: unknown) => void;
  setup: ReturnType<typeof useSetup>;
  journey: Journey | null;
  help: (topic: HelpTopic, zoneId?: number) => Promise<void>;
  helped: Record<string, string>;
};

// Registers the screen's save with the footer on every render, so it always sees the latest input.
function useSave(register: ScreenProps['register'], fn: SaveFn) {
  useEffect(() => { register(fn); });
  useEffect(() => () => register(null), [register]);
}

function ScreenBody(p: ScreenProps) {
  switch (p.screen) {
    case 'language': return <LanguageScreen {...p} />;
    case 'password': return <PasswordScreen {...p} />;
    case 'terms': return <TermsScreen {...p} />;
    case 'telegram': return <TelegramScreen {...p} />;
    case 'alerts': return <AlertsScreen {...p} />;
    case 'community': return <CommunityScreen {...p} />;
    case 'help': return <HelpPrefsScreen {...p} />;
    case 'location': return <LocationScreen {...p} />;
    case 'water': return <WaterScreen {...p} />;
    case 'tank': return <TankScreen {...p} />;
    case 'crop': return <CropScreen {...p} />;
    case 'irrigation': return <IrrigationScreen {...p} />;
    case 'soilType': return <SoilTypeScreen {...p} />;
    case 'size': return <SizeScreen {...p} />;
    default: return <InstallerScreen {...p} />;
  }
}

function Intro({ title, why, styles }: { title: string; why: string; styles: Styles }) {
  return <>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.why}>{why}</Text>
  </>;
}

function HelpLink({ t, styles, sent, onPress, testID }: { t: T; styles: Styles; sent?: string; onPress: () => void; testID: string }) {
  return sent
    ? <Text style={styles.ok} accessibilityLiveRegion="polite" testID={`${testID}-sent`}>{sent}</Text>
    : <Pressable accessibilityRole="button" onPress={onPress} style={styles.linkButton} testID={testID}>
        <Text style={styles.link}>{t('tasks.helpMe')}</Text>
      </Pressable>;
}

function Choice({ label, hint, on, onPress, styles, testID }: { label: string; hint?: string; on: boolean; onPress: () => void; styles: Styles; testID?: string }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={[styles.choice, on && styles.choiceOn]} testID={testID}>
    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{label}</Text>
    {hint ? <Text style={styles.help}>{hint}</Text> : null}
  </Pressable>;
}

// ---------------------------------------------------------------------------------------------
// The four tasks, with "Your details: X of 4" and "Installation: <stage>" as two separate parts
// ---------------------------------------------------------------------------------------------

function Hub({ t, styles, journey, loading, onOpen }: { t: T; styles: Styles; journey: Journey | null; loading: boolean; onOpen: (task: FarmerTaskKey) => void }) {
  const done = new Set(journey?.setupProgress.tasks.filter(x => x.done).map(x => x.key) ?? []);
  return <>
    <Text accessibilityRole="header" style={styles.title}>{t('tasks.title')}</Text>
    <Text style={styles.why}>{t('tasks.why')}</Text>
    <Text style={styles.label} testID="setup-details-count">
      {loading ? t('journey.loading') : journey ? t('journey.details', { done: journey.setupProgress.done, total: journey.setupProgress.total }) : t('journey.unavailable')}
    </Text>
    {journey ? <Text style={styles.label} testID="setup-installation">{t('journey.installation', { stage: t(`journey.stage.${journey.installation.stage}` as TranslationKey) })}</Text> : null}
    {FARMER_TASKS.map(task => <Pressable key={task} accessibilityRole="button" onPress={() => onOpen(task)} style={styles.card} testID={`setup-task-${task}`}
      accessibilityLabel={`${t(`tasks.${task}` as TranslationKey)}: ${done.has(task) ? t('tasks.done') : t('tasks.toDo')}`}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{t(`tasks.${task}` as TranslationKey)}</Text>
        <Text style={[styles.badge, done.has(task) ? styles.badgeOn : styles.badgeOff]}>{done.has(task) ? t('tasks.done') : t('tasks.toDo')}</Text>
      </View>
      <Text style={styles.help}>{t(`tasks.${task}.about` as TranslationKey)}</Text>
    </Pressable>)}
    <Text style={styles.help}>{t('tasks.installerNote')}</Text>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Your preferences
// ---------------------------------------------------------------------------------------------

function LanguageScreen({ t, styles, register, setup }: ScreenProps) {
  const { lang, setLanguage } = useI18n();
  useSave(register, async () => { setup.updateLocal(l => ({ ...l, languageConfirmed: true })); return { ok: true }; });
  return <>
    <Intro styles={styles} title={t('setup.welcome.title')} why={t('setup.welcome.body')} />
    <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.language')} style={{ gap: Spacing.two }}>
      {LANGUAGES.map(o => <Choice key={o.value} styles={styles} on={o.value === lang} onPress={() => { void setLanguage(o.value); }}
        label={`${o.name}${o.beta ? ` ${t('settings.beta')}` : ''}`} testID={`setup-language-${o.value}`} />)}
    </View>
  </>;
}

function PasswordScreen({ t, styles, register, draftFor, setDraft }: ScreenProps) {
  const { mustChangePassword, clearMustChangePassword } = useAuth();
  const pw = draftFor('password.new', '');
  const again = draftFor('password.again', '');
  useSave(register, async () => {
    if (!mustChangePassword) return { ok: true };
    if (pw.length < 8) return { ok: false, error: t('setup.password.tooShort') };
    if (pw !== again) return { ok: false, error: t('setup.password.mismatch') };
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return { ok: false, error: isNetworkError(error) ? t('setup.password.failed') : error.message || t('setup.password.failed') };
    await clearMustChangePassword();
    setDraft('password.new', ''); setDraft('password.again', '');
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.password.title')} why={t('setup.password.why')} />
    {!mustChangePassword ? <Text style={styles.ok}>{t('setup.password.already')}</Text> : <>
      <Text style={styles.label} nativeID="pwNew">{t('setup.password.new')}</Text>
      <TextInput secureTextEntry autoCapitalize="none" value={pw} onChangeText={v => setDraft('password.new', v)} style={styles.input}
        accessibilityLabel={t('setup.password.new')} accessibilityLabelledBy="pwNew" testID="setup-password-new" autoComplete="new-password" />
      <Text style={styles.label} nativeID="pwAgain">{t('setup.password.again')}</Text>
      <TextInput secureTextEntry autoCapitalize="none" value={again} onChangeText={v => setDraft('password.again', v)} style={styles.input}
        accessibilityLabel={t('setup.password.again')} accessibilityLabelledBy="pwAgain" testID="setup-password-again" autoComplete="new-password" />
      <Text style={styles.help}>{t('setup.password.rule')}</Text>
    </>}
  </>;
}

// "Before you start": the draft terms and privacy notice, their version and date, and an
// unticked box. Accepted only when the server recorded it (who, which version, when).
function TermsScreen({ t, styles, register, draftFor, setDraft, journey }: ScreenProps) {
  const ticked = draftFor('terms.ticked', false);
  const accepted = journey?.terms.accepted;
  const docs = journey?.terms.documents ?? [];
  const terms = docs.find(d => d.key === 'terms');
  const privacy = docs.find(d => d.key === 'privacy');
  useSave(register, async () => {
    if (accepted?.all) return { ok: true };
    if (!terms || !privacy) return { ok: false, error: t('terms.unavailable') };
    if (!ticked) return { ok: false, error: t('terms.tickFirst') };
    await acceptTerms(terms.version, privacy.version);
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('terms.title')} why={t('terms.summary')} />
    <View style={styles.card}>
      <Text style={styles.help}>{t('terms.weDo')}</Text>
      <Text style={styles.help}>{t('terms.youDo')}</Text>
      <Text style={styles.help}>{t('terms.limits')}</Text>
    </View>
    {[terms, privacy].map(d => d ? <Pressable key={d.key} accessibilityRole="link" onPress={() => router.push(`/legal?doc=${d.key}` as never)} style={styles.linkButton} testID={`terms-open-${d.key}`}>
      <Text style={styles.link}>{t('terms.read', { title: t(`terms.doc.${d.key}` as TranslationKey) })}</Text>
      <Text style={styles.help}>{t('terms.version', { version: d.version, date: dayLabel(d.date) })} · {d.status === 'draft' ? t('terms.draft') : ''}</Text>
    </Pressable> : null)}
    {accepted?.all
      ? <Text style={styles.ok} testID="terms-accepted">{t('terms.acceptedOn', { date: formatSast(accepted.termsAcceptedAt ?? '') ?? '' })}</Text>
      : <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ticked }} onPress={() => setDraft('terms.ticked', !ticked)}
          style={styles.checkRow} testID="terms-checkbox">
          <View style={[styles.checkbox, ticked && styles.checkboxOn]}>{ticked ? <Text style={styles.checkMark}>✓</Text> : null}</View>
          <Text style={styles.checkLabel}>{t('terms.accept')}</Text>
        </Pressable>}
    <Text style={styles.help}>{t('terms.optionalSeparate')}</Text>
  </>;
}

function TelegramScreen({ t, styles, register, setup }: ScreenProps) {
  const linked = setup.facts.telegramLinked === true;
  useSave(register, async () => { if (!linked) setup.updateLocal(l => ({ ...l, telegramDeclined: true })); return { ok: true }; });
  return <>
    <Intro styles={styles} title={t('setup.telegram.title')} why={t('setup.telegram.why')} />
    <Text style={styles.help}>{t('tasks.optional')}</Text>
    {linked ? <Text style={styles.ok}>{t('setup.telegram.linked')}</Text> : <>
      <TelegramSection />
      <Pressable accessibilityRole="button" onPress={setup.reload} style={styles.secondaryWide}>
        <Text style={styles.secondaryText}>{t('setup.telegram.check')}</Text>
      </Pressable>
    </>}
  </>;
}

function usePreferences(): [NotificationPreferences, (p: NotificationPreferences) => void, boolean] {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { fetchNotificationPreferences().then(p => { setPrefs(p); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
  return [prefs, setPrefs, loaded];
}

function AlertsScreen({ t, styles, register, setup }: ScreenProps) {
  const linked = setup.facts.telegramLinked === true;
  const [prefs, setPrefs] = usePreferences();
  const quiet = !!prefs.quietStart && !!prefs.quietEnd;
  useSave(register, async () => {
    await saveNotificationPreferences(prefs);
    setup.updateLocal(l => confirm(l, 'alerts'));
    return { ok: true };
  });
  const rows: { key: keyof NotificationPreferences; label: TranslationKey }[] = [
    { key: 'wateringTelegram', label: 'setup.alerts.watering' },
    { key: 'lowTankTelegram', label: 'setup.alerts.lowTank' },
    { key: 'droughtTelegram', label: 'setup.alerts.drought' },
    { key: 'communityTelegram', label: 'setup.alerts.community' },
    { key: 'weatherTelegram', label: 'setup.alerts.weather' },
  ];
  return <>
    <Intro styles={styles} title={t('setup.alerts.title')} why={t('setup.alerts.why')} />
    {rows.map(r => <View key={r.key} style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t(r.label)}</Text>
      {linked
        ? <Switch value={prefs[r.key] as boolean} onValueChange={v => setPrefs({ ...prefs, [r.key]: v })}
            accessibilityLabel={t('setup.alerts.telegramFor', { what: t(r.label) })} testID={`setup-alerts-${r.key}`} />
        : <Text style={styles.help}>{t('setup.alerts.inApp')}</Text>}
    </View>)}
    {!linked ? <Text style={styles.help}>{t('setup.alerts.noTelegram')}</Text> : <>
      <View style={styles.switchRow}>
        <Text style={styles.summaryTask}>{t('setup.alerts.quiet')}</Text>
        <Switch value={quiet} onValueChange={on => setPrefs({ ...prefs, quietStart: on ? prefs.quietStart ?? '21:00' : null, quietEnd: on ? prefs.quietEnd ?? '06:00' : null })}
          accessibilityLabel={t('setup.alerts.quiet')} testID="setup-alerts-quiet" />
      </View>
      {quiet ? <Text style={styles.help}>{t('setup.alerts.quietHours', { start: prefs.quietStart ?? '21:00', end: prefs.quietEnd ?? '06:00' })}</Text> : null}
    </>}
  </>;
}

function CommunityScreen({ t, styles, register, setup }: ScreenProps) {
  const [prefs, setPrefs] = usePreferences();
  useSave(register, async () => {
    await saveNotificationPreferences(prefs);
    setup.updateLocal(l => confirm(l, 'community'));
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.community.title')} why={t('setup.community.why')} />
    <Text style={styles.help}>{t('tasks.optional')}</Text>
    <Text style={styles.help}>{t('setup.community.limit')}</Text>
    <Text style={styles.help}>{t('setup.community.unverified')}</Text>
    <View accessibilityRole="radiogroup" style={{ gap: Spacing.two }}>
      <Choice styles={styles} on={prefs.communityOptIn} onPress={() => setPrefs({ ...prefs, communityOptIn: true })} label={t('setup.community.on')} testID="setup-community-on" />
      <Choice styles={styles} on={!prefs.communityOptIn} onPress={() => setPrefs({ ...prefs, communityOptIn: false })} label={t('setup.community.off')} testID="setup-community-off" />
    </View>
  </>;
}

function HelpPrefsScreen({ t, styles, register, setup }: ScreenProps) {
  const { preferences, setPreference } = useAppPreferences();
  useSave(register, async () => { setup.updateLocal(l => confirm(l, 'help')); return { ok: true }; });
  return <>
    <Intro styles={styles} title={t('setup.help.title')} why={t('setup.help.why')} />
    <View style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t('setup.help.drip')}</Text>
      <Switch value={preferences.showRaindropHelper} onValueChange={v => setPreference('showRaindropHelper', v)} accessibilityLabel={t('setup.help.drip')} testID="setup-help-drip" />
    </View>
    <View style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t('setup.help.icons')}</Text>
      <Switch value={preferences.showPageHelp} onValueChange={v => setPreference('showPageHelp', v)} accessibilityLabel={t('setup.help.icons')} testID="setup-help-icons" />
    </View>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Your farm
// ---------------------------------------------------------------------------------------------

function LocationScreen({ t, styles, register, draftFor, setDraft, setup }: ScreenProps) {
  const { farm } = useAgroFlow();
  const f = setup.facts.farm;
  const choice = draftFor<'right' | 'wrong' | null>('location', null);
  const hasPoint = f?.latitude != null && f?.longitude != null;
  const place = [f?.town, f?.province].filter(Boolean).join(', ') || f?.location || t('setup.location.unknown');
  useSave(register, async () => {
    if (!choice) return { ok: false, error: t('tasks.location.choose'), missing: true };
    if (choice === 'wrong' && farm) await reportLocationProblem(farm.id);
    setup.updateLocal(l => choice === 'right' ? confirm(l, 'location') : { ...l, locationFlagged: true });
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.location.title')} why={t('setup.location.why')} />
    <Text style={styles.cardTitle} testID="setup-location-place">{place}</Text>
    {hasPoint
      ? <View style={styles.mapBox} testID="setup-location-map" accessibilityLabel={t('setup.location.mapA11y', { place })}>
          <FarmMapSurface latitude={f!.latitude!} longitude={f!.longitude!} zoom={13} onFailure={() => undefined} />
        </View>
      : <Text style={styles.help}>{t('setup.location.noPoint')}</Text>}
    <View accessibilityRole="radiogroup" style={{ gap: Spacing.two }}>
      <Choice styles={styles} on={choice === 'right'} onPress={() => setDraft('location', 'right')} label={t('setup.looksRight')} testID="setup-location-right" />
      <Choice styles={styles} on={choice === 'wrong'} onPress={() => setDraft('location', 'wrong')} label={t('setup.location.wrong')} testID="setup-location-wrong" />
    </View>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Your water
// ---------------------------------------------------------------------------------------------

function WaterScreen({ t, styles, register, draftFor, setDraft, setup }: ScreenProps) {
  const { farm } = useAgroFlow();
  const saved = setup.farmSetup?.farm?.waterSource ?? null;
  const source = draftFor<string | null>('water', saved);
  useSave(register, async () => {
    if (!source) return { ok: false, error: t('tasks.water.choose'), missing: true };
    if (farm && source !== saved) { await saveWaterSource(farm.id, source); setup.reload(); }
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.water.title')} why={t('setup.water.why')} />
    <View accessibilityRole="radiogroup" style={{ gap: Spacing.two }}>
      {WATER_SOURCES.map(s => <Choice key={s} styles={styles} on={source === s} onPress={() => setDraft('water', s)}
        label={t(`setup.water.${s}` as TranslationKey)} testID={`setup-water-${s}`} />)}
    </View>
  </>;
}

// The tank: size and how full it is now. Unknown size is not "no tank": "I don't know – help me".
function TankScreen({ t, styles, register, draftFor, setDraft, setup }: ScreenProps) {
  const { farm } = useAgroFlow();
  const savedCapacity = setup.farmSetup?.tank?.capacityLitres ?? null;
  const savedLeft = setup.farmSetup?.tank?.estimatedRemainingLitres ?? null;
  const size = draftFor<number | null>('tank.size', null);
  const custom = draftFor('tank.custom', '');
  const level = draftFor<number | null>('tank.level', null);
  const capacity = size ?? (Number(custom.replace(',', '.')) || null);
  useSave(register, async () => {
    if (!farm) return { ok: true };
    // A tank already saved and nothing new typed: keep it.
    if (capacity === null && level === null && savedCapacity) return { ok: true };
    if (!capacity || capacity <= 0) return { ok: false, error: t('setup.tank.needSize'), missing: true };
    if (level === null) return { ok: false, error: t('setup.tank.needLevel'), missing: true };
    await saveTankCapacity(farm.id, capacity);
    await logTankRefill(farm.id, { litresAdded: tankLitres(capacity, level), waterPh: null, refilledAt: new Date().toISOString() });
    setup.reload();
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.tank.title')} why={t('setup.tank.why')} />
    {savedCapacity ? <Text style={styles.ok} testID="setup-tank-saved">
      {t('tasks.tank.saved', { litres: Math.round(savedCapacity).toLocaleString('en-ZA').replace(/,/g, ' ') })}
      {savedLeft != null ? ` · ${t('home.tankLeft', { litres: Math.round(savedLeft) })}` : ''}
    </Text> : null}
    <Text style={styles.label}>{t('setup.tank.size')}</Text>
    <View style={styles.chips} accessibilityRole="radiogroup">
      {TANK_SIZES.map(s => <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: size === s }}
        onPress={() => { setDraft('tank.size', s); setDraft('tank.custom', ''); }} style={[styles.chip, size === s && styles.chipOn]} testID={`setup-tank-size-${s}`}>
        <Text style={[styles.chipText, size === s && styles.chipTextOn]}>{t('setup.tank.litres', { n: s.toLocaleString('en-ZA').replace(/,/g, ' ') })}</Text>
      </Pressable>)}
    </View>
    <TextInput keyboardType="number-pad" value={custom} onChangeText={v => { setDraft('tank.custom', v); setDraft('tank.size', null); }} style={styles.input}
      placeholder={t('setup.tank.custom')} accessibilityLabel={t('setup.tank.custom')} testID="setup-tank-custom" />
    <Text style={styles.label}>{t('setup.tank.howFull')}</Text>
    <View style={styles.chips} accessibilityRole="radiogroup">
      {TANK_LEVELS.map(l => <Pressable key={l.key} accessibilityRole="radio" accessibilityState={{ checked: level === l.fraction }}
        onPress={() => setDraft('tank.level', l.fraction)} style={[styles.chip, level === l.fraction && styles.chipOn]} testID={`setup-tank-level-${l.key}`}>
        <Text style={[styles.chipText, level === l.fraction && styles.chipTextOn]}>{t(`setup.tank.${l.key}` as TranslationKey)}</Text>
      </Pressable>)}
    </View>
  </>;
}

// ---------------------------------------------------------------------------------------------
// Your crops (one card per field; each field has its own "I don't know – help me")
// ---------------------------------------------------------------------------------------------

const WEEK_CHOICES = [0, 1, 2, 4, 6, 8, 12, 16];

function ZoneHelp({ t, styles, help, helped, screen, zoneId, topic }: { t: T; styles: Styles; help: ScreenProps['help']; helped: ScreenProps['helped']; screen: ScreenKey; zoneId: number; topic: HelpTopic }) {
  return <HelpLink t={t} styles={styles} sent={helped[`${screen}:${zoneId}`]} onPress={() => { void help(topic, zoneId); }} testID={`setup-help-${screen}-${zoneId}`} />;
}

function CropScreen({ t, styles, register, draftFor, setDraft, setup, help, helped, screen }: ScreenProps) {
  const { refreshZones } = useAgroFlow();
  const zones = setup.facts.zones;
  const todayIso = new Date().toISOString().slice(0, 10);
  useSave(register, async () => {
    for (const z of zones) {
      const crop = draftFor<string | null>(`crop.${z.zoneId}`, ZONE_CROPS.some(c => c.value === z.crop) ? z.crop : null);
      const planted = draftFor<string | null>(`planted.${z.zoneId}`, z.plantingDate);
      if (helped[`crop:${z.zoneId}`]) continue;
      if (!crop || !planted) return { ok: false, error: t('tasks.crop.needBoth', { zone: z.name }) };
      if (crop !== z.crop || planted !== z.plantingDate) await changeZoneCrop(z.zoneId, { cropType: crop, plantingDate: planted });
    }
    refreshZones(); setup.reload();
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('setup.zones.title')} why={t('setup.zones.why')} />
    {zones.length === 0 ? <Text style={styles.help}>{t('setup.zones.none')}</Text> : null}
    {zones.map(z => {
      const crop = draftFor<string | null>(`crop.${z.zoneId}`, ZONE_CROPS.some(c => c.value === z.crop) ? z.crop : null);
      const planted = draftFor<string | null>(`planted.${z.zoneId}`, z.plantingDate);
      return <View key={z.zoneId} style={styles.card} testID={`setup-zone-${z.zoneId}`}>
        <Text style={styles.cardTitle}>{z.name}</Text>
        <Text style={styles.label}>{t('setup.zones.crop')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {ZONE_CROPS.map(c => <Pressable key={c.value} accessibilityRole="radio" accessibilityState={{ checked: crop === c.value }}
            onPress={() => setDraft(`crop.${z.zoneId}`, c.value)} style={[styles.chip, crop === c.value && styles.chipOn]} testID={`setup-crop-${z.zoneId}-${c.value}`}>
            <Text style={[styles.chipText, crop === c.value && styles.chipTextOn]}>{t(`crop.${c.value}` as TranslationKey)}</Text>
          </Pressable>)}
        </View>
        <Text style={styles.label}>{t('setup.zones.plantedQ')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {WEEK_CHOICES.map(w => {
            const iso = plantedWeeksAgo(w) ?? todayIso;
            return <Pressable key={w} accessibilityRole="radio" accessibilityState={{ checked: planted === iso }} onPress={() => setDraft(`planted.${z.zoneId}`, iso)}
              style={[styles.chip, planted === iso && styles.chipOn]} testID={`setup-planted-${z.zoneId}-${w}`}>
              <Text style={[styles.chipText, planted === iso && styles.chipTextOn]}>{w === 0 ? t('setup.zones.thisWeek') : t('setup.zones.weeks', { n: w })}</Text>
            </Pressable>;
          })}
        </View>
        {planted ? <Text style={styles.help}>{t('setup.zones.planted', { date: dayLabel(planted) })}</Text> : null}
        <ZoneHelp t={t} styles={styles} help={help} helped={helped} screen={screen} zoneId={z.zoneId} topic="crop" />
      </View>;
    })}
  </>;
}

function IrrigationScreen({ t, styles, register, draftFor, setDraft, setup, help, helped, screen }: ScreenProps) {
  const zones = setup.facts.zones;
  useSave(register, async () => {
    for (const z of zones) {
      const type = draftFor<string | null>(`irrigation.${z.zoneId}`, z.irrigationType ?? null);
      if (type && type !== z.irrigationType) await saveIrrigationType(z.zoneId, type);
    }
    setup.reload();
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('tasks.irrigation.title')} why={t('setup.irrigation.why')} />
    <Text style={styles.help}>{t('tasks.optional')}</Text>
    {zones.map(z => {
      const type = draftFor<string | null>(`irrigation.${z.zoneId}`, z.irrigationType ?? null);
      return <View key={z.zoneId} style={styles.card}>
        <Text style={styles.cardTitle}>{z.name}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {IRRIGATION_TYPES.map(k => <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: type === k }}
            onPress={() => setDraft(`irrigation.${z.zoneId}`, k)} style={[styles.chip, type === k && styles.chipOn]} testID={`setup-irrigation-${z.zoneId}-${k}`}>
            <Text style={[styles.chipText, type === k && styles.chipTextOn]}>{t(`setup.irrigation.${k}` as TranslationKey)}</Text>
          </Pressable>)}
        </View>
        <ZoneHelp t={t} styles={styles} help={help} helped={helped} screen={screen} zoneId={z.zoneId} topic="irrigation_type" />
      </View>;
    })}
  </>;
}

function SoilTypeScreen({ t, styles, register, draftFor, setDraft, setup }: ScreenProps) {
  const zones = setup.facts.zones;
  useSave(register, async () => {
    for (const z of zones) {
      const soil = draftFor<string>(`soil.${z.zoneId}`, z.soilType ?? 'loam');
      if (soil !== (z.soilType ?? 'loam')) await saveZoneSoilType(z.zoneId, soil as never);
      setup.updateLocal(l => confirm(l, soilTypeKey(z.zoneId)));
    }
    setup.reload();
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('tasks.soilType.title')} why={t('setup.soilType.why')} />
    {zones.map(z => {
      const soil = draftFor<string>(`soil.${z.zoneId}`, z.soilType ?? 'loam');
      return <View key={z.zoneId} style={styles.card}>
        <Text style={styles.cardTitle}>{z.name}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: Spacing.two }}>
          {SOIL_TYPES.map(s => <Choice key={s} styles={styles} on={soil === s} onPress={() => setDraft(`soil.${z.zoneId}`, s)}
            label={t(`setup.soilType.${s}` as TranslationKey)} hint={t(`setup.soilType.${s}Desc` as TranslationKey)} testID={`setup-soil-${z.zoneId}-${s}`} />)}
        </View>
      </View>;
    })}
  </>;
}

// Field size: the saved value is labelled as saved; a typed one is a new value (AF-07).
function SizeScreen({ t, styles, register, draftFor, setDraft, setup, help, helped, screen }: ScreenProps) {
  const zones = setup.facts.zones;
  useSave(register, async () => {
    for (const z of zones) {
      const value = draftFor(`size.${z.zoneId}`, '');
      const unit = draftFor<'m2' | 'ha'>(`sizeUnit.${z.zoneId}`, 'm2');
      if (!value.trim()) continue;
      const m2 = areaToM2(Number(value.replace(',', '.')), unit);
      if (m2 === null) return { ok: false, error: t('setup.size.invalid') };
      await saveZoneSetup(z.zoneId, { areaM2: m2 });
    }
    setup.reload();
    return { ok: true };
  });
  return <>
    <Intro styles={styles} title={t('tasks.size.title')} why={t('setup.size.why')} />
    <Text style={styles.help}>{t('tasks.size.optional')}</Text>
    {zones.map(z => {
      const value = draftFor(`size.${z.zoneId}`, '');
      const unit = draftFor<'m2' | 'ha'>(`sizeUnit.${z.zoneId}`, 'm2');
      return <View key={z.zoneId} style={styles.card}>
        <Text style={styles.cardTitle}>{z.name}</Text>
        <Text style={styles.help} testID={`setup-size-saved-${z.zoneId}`}>
          {z.areaM2 ? t('tasks.size.saved', { area: formatAreaM2(z.areaM2) ?? '' }) : t('tasks.size.notSaved')}
        </Text>
        <TextInput keyboardType="decimal-pad" value={value} onChangeText={v => setDraft(`size.${z.zoneId}`, v)} style={styles.input}
          accessibilityLabel={t('setup.size.label')} testID={`setup-size-value-${z.zoneId}`} />
        <View style={styles.chips} accessibilityRole="radiogroup">
          {(['m2', 'ha'] as const).map(u => <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: unit === u }}
            onPress={() => setDraft(`sizeUnit.${z.zoneId}`, u)} style={[styles.chip, unit === u && styles.chipOn]} testID={`setup-size-unit-${z.zoneId}-${u}`}>
            <Text style={[styles.chipText, unit === u && styles.chipTextOn]}>{t(`setup.size.${u}Unit` as TranslationKey)}</Text>
          </Pressable>)}
        </View>
        <ZoneHelp t={t} styles={styles} help={help} helped={helped} screen={screen} zoneId={z.zoneId} topic="area" />
      </View>;
    })}
  </>;
}

// What the installer does: read only. "Your installer will complete this", or who did it and when.
function InstallerScreen({ t, styles, register, journey }: ScreenProps) {
  useSave(register, async () => ({ ok: true }));
  const zones = journey?.zones ?? [];
  return <>
    <Intro styles={styles} title={t('tasks.installer.title')} why={t('tasks.installer.why')} />
    {zones.length === 0 ? <Text style={styles.help}>{t('tasks.installer.later')}</Text> : null}
    {zones.map(z => <View key={z.zoneId} style={styles.card} testID={`setup-installer-${z.zoneId}`}>
      <Text style={styles.cardTitle}>{z.name}</Text>
      {z.commissionState === 'legacy' ? <Text style={styles.help}>{t('tasks.installer.legacy')}</Text>
        : z.installerChecks.map(k => <View key={k.item} style={styles.summaryRow}>
          <Text style={styles.summaryTask}>{t(`tasks.check.${k.item}` as TranslationKey)}</Text>
          <Text style={[styles.summaryState, k.done ? styles.summaryOk : styles.summaryTodo]}>
            {k.done ? (k.doneAt ? t('tasks.installer.doneOn', { date: formatSast(k.doneAt) ?? '' }) : t('tasks.done')) : t('tasks.installer.will')}
          </Text>
        </View>)}
    </View>)}
  </>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    // 320-430 px phones use the full width; wider screens (web, tablets) get a centred column.
    frame: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
    progressHead: { paddingHorizontal: Layout.gutter, paddingTop: Spacing.three, gap: Spacing.two },
    progressText: { color: colors.textSecondary, fontSize: Type.caption, fontWeight: '600' },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
    content: { padding: Layout.gutter, gap: Spacing.three },
    title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
    why: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 23 },
    label: { color: colors.text, fontSize: Type.body, fontWeight: '600', marginTop: Spacing.one },
    help: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 22 },
    choice: { minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, backgroundColor: colors.surface },
    choiceOn: { borderColor: colors.primaryDark, borderWidth: 2 },
    choiceText: { color: colors.text, fontSize: Type.body },
    choiceTextOn: { fontWeight: '700', color: colors.primaryDark },
    input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, fontSize: Type.body, backgroundColor: colors.surface },
    ok: { color: colors.success, fontSize: Type.body, lineHeight: 22, fontWeight: '600' },
    error: { color: colors.error, fontSize: Type.body, lineHeight: 22 },
    footerError: { paddingHorizontal: Layout.gutter, paddingTop: Spacing.two },
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, backgroundColor: colors.surface },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
    cardTitle: { color: colors.text, fontSize: Type.title, fontWeight: '600', flexShrink: 1 },
    badge: { fontSize: Type.caption, fontWeight: '700', paddingHorizontal: Spacing.two, paddingVertical: Space.xs, borderRadius: 999, overflow: 'hidden' },
    badgeOn: { color: colors.white, backgroundColor: colors.success },
    badgeOff: { color: colors.text, backgroundColor: colors.warningBackground },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    chip: { minHeight: 48, minWidth: 48, paddingHorizontal: Spacing.three, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
    chipText: { color: colors.text, fontSize: Type.body },
    chipTextOn: { color: colors.white, fontWeight: '700' },
    summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, gap: Spacing.two },
    summaryTask: { color: colors.text, fontSize: Type.body, flex: 1 },
    summaryState: { fontSize: Type.body, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
    summaryOk: { color: colors.success },
    summaryTodo: { color: colors.textSecondary },
    footer: { flexDirection: 'row', gap: Spacing.two, padding: Layout.gutter, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, backgroundColor: colors.background },
    primary: { flex: 2, minHeight: 52, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
    primaryText: { color: colors.white, fontSize: Type.body, fontWeight: '700', textAlign: 'center' },
    secondary: { flex: 1, minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryWide: { minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    linkButton: { minHeight: 48, justifyContent: 'center', gap: 2 },
    link: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', textDecorationLine: 'underline' },
    disabled: { opacity: 0.6 },
    mapBox: { height: 180, borderRadius: Radius.sm, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
    switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52 },
    checkbox: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    checkboxOn: { backgroundColor: colors.primaryDark },
    checkMark: { color: colors.white, fontSize: 18, fontWeight: '700' },
    checkLabel: { flex: 1, color: colors.text, fontSize: Type.body, lineHeight: 22 },
  });
}
