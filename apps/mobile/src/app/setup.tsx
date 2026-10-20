// The setup wizard: one question per screen, from first sign-in to "All set", in four sections
// with their own progress - You, Your farm, Each zone, Alerts & help (17 steps).
//   /setup             resumes at the first step not done
//   /setup?step=soil   opens one step (from the zone screen, Settings or Home's card)
//   /setup?redo=1      "Redo setup" in Settings: every step, from the start
// Everything the installer entered is shown pre-filled with "Looks right"; each value can be
// changed later in Settings or on the zone screen. Farmers do not edit their farm's location
// (staff set it); step 4 only confirms it or tells the field officer. Progress is what the
// server knows plus a little kept on the phone (lib/setupProgress.ts).
// Outside the tab group, so the tab bar is hidden while it is open.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { LANGUAGES, useI18n, type TranslationKey } from '@/i18n';
import { TelegramSection } from '@/components/TelegramSection';
import Drip from '@/components/mascot/Drip';
import FarmMapSurface from '@/components/FarmMapSurface';
import { useAppPreferences } from '@/hooks/useAppPreferences';
import {
  DEFAULT_PREFERENCES, changeZoneCrop, fetchNotificationPreferences, logTankRefill, reportLocationProblem,
  saveIrrigationType, saveNotificationPreferences, saveTankCapacity, saveWaterSource, saveZoneCalibration,
  saveZoneSetup, saveZoneSoilType, type NotificationPreferences,
} from '@/services/agroFlowApi';
import { isNetworkError } from '@/lib/connectivity';
import { ZONE_CROPS, dayLabel, plantedWeeksAgo, shiftDate } from '@/lib/setupHelpers';
import { useSetup } from '@/hooks/useSetup';
import {
  IRRIGATION_TYPES,
  NO_FARM,
  OPTIONAL_STEPS,
  SETUP_SECTIONS,
  SETUP_STEPS,
  SOIL_TYPES,
  TANK_LEVELS,
  TANK_SIZES,
  WATER_SOURCES,
  addUnsent,
  areaToM2,
  confirm,
  flowRateFromContainer,
  nextStep,
  previousStep,
  resumeStep,
  sameAsFirst,
  sectionProgress,
  setupComplete,
  soilConfidence,
  soilTypeKey,
  stepDone,
  stepNumber,
  tankLitres,
  type IrrigationType,
  type SetupStep,
  type SetupZone,
  type SoilType,
  type WaterSource,
} from '@/lib/setupProgress';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

function isStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && (SETUP_STEPS as readonly string[]).includes(value);
}

export default function SetupScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ step?: string; redo?: string }>();
  const redo = params.redo === '1';
  const setup = useSetup();
  const { facts, ready, updateLocal } = setup;

  // The first step shown: the one asked for, else where the farmer left off.
  const [step, setStep] = useState<SetupStep | null>(null);
  useEffect(() => {
    if (step || !ready) return;
    setStep(isStep(params.step) ? params.step : redo ? 'welcome' : resumeStep(facts));
  }, [ready, step, params.step, redo, facts]);

  const goNext = useCallback(() => {
    if (!step) return;
    setStep(nextStep(step, facts, redo));
  }, [step, facts, redo]);

  const goLater = useCallback(() => {
    if (!step) return;
    updateLocal(l => ({ ...l, skipped: l.skipped.includes(step) ? l.skipped : [...l.skipped, step] }));
    setStep(nextStep(step, facts, redo));
  }, [step, facts, redo, updateLocal]);

  const goBack = useCallback(() => {
    const back = step ? previousStep(step) : null;
    if (back) setStep(back);
    else if (router.canGoBack()) router.back();
  }, [step]);

  // "Looks right": confirms a pre-filled answer and moves on.
  const looksRight = useCallback((key: string) => {
    updateLocal(l => confirm(l, key));
    if (step) setStep(nextStep(step, { ...facts, confirmed: [...(facts.confirmed ?? []), key] }, redo));
  }, [updateLocal, step, facts, redo]);

  if (!step) {
    return <SafeAreaView style={styles.page}><ActivityIndicator style={{ marginTop: 80 }} color={colors.primaryDark} /></SafeAreaView>;
  }

  const done = stepDone(step, facts);
  const optional = OPTIONAL_STEPS.includes(step);
  // A forced password change cannot be put off or stepped past.
  const blocked = step === 'password' && facts.mustChangePassword;
  const { n, of, section } = stepNumber(step);
  const sp = sectionProgress(section, facts);

  const body = step === 'welcome' ? <WelcomeStep t={t} styles={styles} />
    : step === 'password' ? <PasswordStep t={t} styles={styles} />
    : step === 'telegram' ? <TelegramStep t={t} styles={styles} linked={facts.telegramLinked === true}
        onCheck={setup.reload} onNone={() => { updateLocal(l => ({ ...l, telegramDeclined: true })); goNext(); }} />
    : step === 'location' ? <LocationStep t={t} styles={styles} setup={setup} onRight={() => looksRight('location')} />
    : step === 'water' ? <WaterStep t={t} styles={styles} setup={setup}
        onSaved={source => setStep(nextStep('water', { ...facts, farm: { ...(facts.farm ?? NO_FARM), waterSource: source } }, redo))} />
    : step === 'tank' ? <TankStep t={t} styles={styles} setup={setup} onSaved={goNext} />
    : step === 'crop' ? <ZonesStep t={t} styles={styles} zones={facts.zones} setup={setup} />
    : step === 'irrigation' ? <IrrigationStep t={t} styles={styles} zones={facts.zones} setup={setup} />
    : step === 'soilType' ? <SoilTypeStep t={t} styles={styles} zones={facts.zones} setup={setup} />
    : step === 'size' ? <SizeStep t={t} styles={styles} zones={facts.zones} setup={setup} />
    : step === 'flow' ? <FlowStep t={t} styles={styles} zones={facts.zones} setup={setup} />
    : step === 'soil' ? <SoilStep t={t} styles={styles} zones={facts.zones} />
    : step === 'maxRun' ? <MaxRunStep t={t} styles={styles} zones={facts.zones} onRight={() => looksRight('maxRun')} />
    : step === 'alerts' ? <AlertsStep t={t} styles={styles} linked={facts.telegramLinked === true} onSaved={() => looksRight('alerts')} />
    : step === 'community' ? <CommunityStep t={t} styles={styles} onSaved={() => looksRight('community')} />
    : step === 'help' ? <HelpStep t={t} styles={styles} onRight={() => looksRight('help')} />
    : <DoneStep t={t} styles={styles} setup={setup} />;

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.frame}>
      <View style={styles.progressHead} accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: of, now: n }} accessibilityLabel={t('setup.progress', { n, of })}>
        <View style={styles.sectionRow}>
          {SETUP_SECTIONS.map(s => {
            const p = sectionProgress(s, facts);
            return <Text key={s} testID={`setup-section-${s}`}
              style={[styles.sectionChip, s === section && styles.sectionChipOn, p.done === p.total && styles.sectionChipDone]}>
              {t(`setup.section.${s}` as TranslationKey)} {p.done}/{p.total}
            </Text>;
          })}
        </View>
        <Text style={styles.progressText} testID="setup-progress">{t('setup.progress', { n, of })} · {t(`setup.section.${section}` as TranslationKey)} {sp.done}/{sp.total}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(n / of) * 100}%` }]} /></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={`setup-step-${step}`}>
        {body}
      </ScrollView>
      <View style={styles.footer}>
        {previousStep(step) || router.canGoBack()
          ? <Pressable accessibilityRole="button" onPress={goBack} style={styles.secondary} testID="setup-back">
              <Text style={styles.secondaryText}>{t('setup.back')}</Text>
            </Pressable>
          : <View style={{ flex: 1 }} />}
        {step === 'done'
          ? <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.primary} testID="setup-go">
              <Text style={styles.primaryText}>{t('setup.done.go')}</Text>
            </Pressable>
          : optional && !done
            ? <Pressable accessibilityRole="button" onPress={goLater} style={styles.primary} testID="setup-later">
                <Text style={styles.primaryText}>{t('setup.later')}</Text>
              </Pressable>
            : <Pressable accessibilityRole="button" disabled={blocked}
                accessibilityState={{ disabled: blocked }}
                onPress={() => { if (step === 'welcome') updateLocal(l => ({ ...l, languageConfirmed: true })); goNext(); }}
                style={[styles.primary, blocked && styles.disabled]} testID="setup-continue">
                <Text style={styles.primaryText}>{t('setup.continue')}</Text>
              </Pressable>}
      </View>
    </View>
  </SafeAreaView>;
}

type Styles = ReturnType<typeof createStyles>;

function StepIntro({ title, why, tip, styles }: { title: string; why: string; tip?: string; styles: Styles }) {
  return <>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.why}>{why}</Text>
    {tip ? <View style={styles.tip} accessibilityLabel={tip}>
      <Drip mood="happy" size={34} />
      <Text style={styles.tipText}>{tip}</Text>
    </View> : null}
  </>;
}

// 1. Welcome and language: the same setting as Settings -> Language, applied at once.
function WelcomeStep({ t, styles }: { t: T; styles: Styles }) {
  const { lang, setLanguage } = useI18n();
  return <>
    <StepIntro styles={styles} title={t('setup.welcome.title')} why={t('setup.welcome.body')} />
    <Text style={styles.label}>{t('settings.language')}</Text>
    <Text style={styles.help}>{t('setup.welcome.why')}</Text>
    {LANGUAGES.map(option => {
      const selected = option.value === lang;
      return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }}
        testID={`setup-language-${option.value}`} onPress={() => { void setLanguage(option.value); }}
        style={[styles.choice, selected && styles.choiceOn]}>
        <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>
          {option.name}{option.beta ? ` ${t('settings.beta')}` : ''}
        </Text>
      </Pressable>;
    })}
    <StepTip styles={styles} text={t('setup.welcome.tip')} />
  </>;
}

function StepTip({ styles, text }: { styles: Styles; text: string }) {
  return <View style={styles.tip}><Drip mood="wave" size={34} /><Text style={styles.tipText}>{text}</Text></View>;
}

// 2. Set your own password: the first-login change, moved here from /update-password.
function PasswordStep({ t, styles }: { t: T; styles: Styles }) {
  const { mustChangePassword, clearMustChangePassword } = useAuth();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    if (pw.length < 8) { setError(t('setup.password.tooShort')); return; }
    if (pw !== again) { setError(t('setup.password.mismatch')); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: pw });
      if (updateError) throw updateError;
      // Unlocks the rest of the app; if it fails the new password still works and they can retry.
      await clearMustChangePassword();
      setSaved(true);
      setPw(''); setAgain('');
    } catch (e) {
      setError(isNetworkError(e) ? t('setup.password.failed') : e instanceof Error && e.message ? e.message : t('setup.password.failed'));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <StepIntro styles={styles} title={t('setup.password.title')} why={t('setup.password.why')} tip={t('setup.password.tip')} />
    {!mustChangePassword && !saved
      ? <Text style={styles.ok}>{t('setup.password.already')}</Text>
      : saved ? <Text style={styles.ok} accessibilityLiveRegion="polite">{t('setup.password.saved')}</Text>
      : <>
        <Text style={styles.label}>{t('setup.password.new')}</Text>
        <TextInput secureTextEntry autoCapitalize="none" value={pw} onChangeText={setPw} style={styles.input}
          accessibilityLabel={t('setup.password.new')} testID="setup-password-new" autoComplete="new-password" />
        <Text style={styles.label}>{t('setup.password.again')}</Text>
        <TextInput secureTextEntry autoCapitalize="none" value={again} onChangeText={setAgain} style={styles.input}
          accessibilityLabel={t('setup.password.again')} testID="setup-password-again" autoComplete="new-password" />
        <Text style={styles.help}>{t('setup.password.rule')}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void save(); }} style={[styles.action, busy && styles.disabled]} testID="setup-password-save">
          {busy ? <ActivityIndicator color={styles.actionText.color} /> : <Text style={styles.actionText}>{t('setup.password.save')}</Text>}
        </Pressable>
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      </>}
  </>;
}

// 3. Telegram: optional, but it is how alerts and password resets reach the farmer.
function TelegramStep({ t, styles, linked, onCheck, onNone }: { t: T; styles: Styles; linked: boolean; onCheck: () => void; onNone: () => void }) {
  return <>
    <StepIntro styles={styles} title={t('setup.telegram.title')} why={t('setup.telegram.why')} tip={t('setup.telegram.tip')} />
    {linked ? <Text style={styles.ok}>{t('setup.telegram.linked')}</Text> : <>
      <TelegramSection />
      <Pressable accessibilityRole="button" onPress={onCheck} style={styles.secondaryWide}>
        <Text style={styles.secondaryText}>{t('setup.telegram.check')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onNone} style={styles.linkButton} testID="setup-telegram-none">
        <Text style={styles.link}>{t('setup.telegram.none')}</Text>
      </Pressable>
    </>}
  </>;
}

function KitBadge({ t, styles, zone }: { t: T; styles: Styles; zone: SetupZone }) {
  return <Text style={[styles.badge, zone.hasKit ? styles.badgeOn : styles.badgeOff]}>
    {zone.hasKit ? t('setup.zones.kit') : t('setup.zones.waiting')}
  </Text>;
}

// 4. Zones: confirm the crop and the planting date of each.
const WEEK_CHOICES = [0, 1, 2, 4, 6, 8, 12, 16];

function ZonesStep({ t, styles, zones, setup }: { t: T; styles: Styles; zones: SetupZone[]; setup: ReturnType<typeof useSetup> }) {
  const { i, zone, next, go } = useZoneIndex(zones);
  const { refreshZones } = useAgroFlow();
  const [error, setError] = useState<string | null>(null);
  const first = zones[0];
  const copyFirst = async () => {
    setError(null);
    if (!zone || !first?.crop) return;
    try {
      await changeZoneCrop(zone.zoneId, { cropType: first.crop, plantingDate: first.plantingDate });
      refreshZones();
      setup.reload();
      if (i < zones.length - 1) next();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  return <>
    <StepIntro styles={styles} title={t('setup.zones.title')} why={t('setup.zones.why')} tip={t('setup.zones.tip')} />
    <ZonePager t={t} styles={styles} zones={zones} i={i} go={go} />
    {zone && i > 0 && first?.crop ? <Pressable accessibilityRole="button" onPress={() => { void copyFirst(); }} style={styles.secondaryWide} testID="setup-crop-same">
      <Text style={styles.secondaryText}>{t('setup.sameAsFirst', { zone: first.name })}</Text>
    </Pressable> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    {!zone ? <Text style={styles.help}>{t('setup.zones.none')}</Text>
      : <ZoneCard key={zone.zoneId} t={t} styles={styles} zone={zone} setup={setup} onSaved={i < zones.length - 1 ? next : undefined} />}
  </>;
}

function ZoneCard({ t, styles, zone, setup, onSaved }: { t: T; styles: Styles; zone: SetupZone; setup: ReturnType<typeof useSetup>; onSaved?: () => void }) {
  const { refreshZones } = useAgroFlow();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [crop, setCrop] = useState<string | null>(ZONE_CROPS.some(c => c.value === zone.crop) ? zone.crop : null);
  const [planted, setPlanted] = useState<string>(zone.plantingDate ?? todayIso);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setMessage(null); setError(null);
    if (!crop) { setError(t('setup.zones.needCrop')); return; }
    setBusy(true);
    try {
      await changeZoneCrop(zone.zoneId, { cropType: crop, plantingDate: planted });
      setMessage(t('setup.zones.confirmed', { zone: zone.name }));
      refreshZones();
      setup.reload();
      onSaved?.();
    } catch (e) {
      if (isNetworkError(e)) {
        // No signal: kept on the phone and sent when the connection is back (useSetup).
        setup.updateLocal(l => ({ ...l, unsent: addUnsent(l.unsent, { kind: 'crop', zoneId: zone.zoneId, cropType: crop, plantingDate: planted }) }));
        setMessage(t('offline.savedForLater'));
      } else {
        setError(e instanceof Error && e.message ? e.message : t('log.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.card} testID={`setup-zone-${zone.zoneId}`}>
    <View style={styles.cardHead}><Text style={styles.cardTitle}>{zone.name}</Text><KitBadge t={t} styles={styles} zone={zone} /></View>
    <Text style={styles.label}>{t('setup.zones.crop')}</Text>
    <View style={styles.chips}>
      {ZONE_CROPS.map(c => <Pressable key={c.value} accessibilityRole="radio" accessibilityState={{ checked: crop === c.value }}
        onPress={() => setCrop(c.value)} style={[styles.chip, crop === c.value && styles.chipOn]}>
        <Text style={[styles.chipText, crop === c.value && styles.chipTextOn]}>{c.label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.label}>{t('setup.zones.plantedQ')}</Text>
    <View style={styles.chips}>
      {WEEK_CHOICES.map(w => {
        const iso = plantedWeeksAgo(w) ?? todayIso;
        return <Pressable key={w} accessibilityRole="button" onPress={() => setPlanted(iso)} style={[styles.chip, planted === iso && styles.chipOn]}>
          <Text style={[styles.chipText, planted === iso && styles.chipTextOn]}>{w === 0 ? t('setup.zones.thisWeek') : t('setup.zones.weeks', { n: w })}</Text>
        </Pressable>;
      })}
    </View>
    <View style={styles.dateRow}>
      <Pressable accessibilityRole="button" onPress={() => setPlanted(p => shiftDate(p, -1, todayIso))} style={styles.dateButton}>
        <Text style={styles.secondaryText}>{t('setup.zones.dayEarlier')}</Text>
      </Pressable>
      <Text style={styles.dateText} accessibilityLiveRegion="polite">{t('setup.zones.planted', { date: dayLabel(planted) })}</Text>
      <Pressable accessibilityRole="button" onPress={() => setPlanted(p => shiftDate(p, 1, todayIso))} style={styles.dateButton}>
        <Text style={styles.secondaryText}>{t('setup.zones.dayLater')}</Text>
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void confirm(); }} style={[styles.action, busy && styles.disabled]}>
      <Text style={styles.actionText}>{t('setup.zones.confirm', { zone: zone.name })}</Text>
    </Pressable>
    {message ? <Text style={styles.ok} accessibilityLiveRegion="polite">{message}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>;
}

// 5. Flow: a stopwatch and the container's size give litres a minute.
function FlowStep({ t, styles, zones, setup }: { t: T; styles: Styles; zones: SetupZone[]; setup: ReturnType<typeof useSetup> }) {
  // The zones may still be loading on first render, so the choice falls back to the first one
  // still without a flow rate until the farmer picks one.
  const [picked, setZoneId] = useState<number | null>(null);
  const zoneId = picked ?? zones.find(z => !z.hasFlowRate)?.zoneId ?? zones[0]?.zoneId ?? null;
  const zone = zones.find(z => z.zoneId === zoneId) ?? null;
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<'L' | 'ml'>('L');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const start = () => {
    setError(null); setMessage(null); setSeconds(null);
    setStartedAt(Date.now());
    timer.current = setInterval(() => setNow(Date.now()), 100);
  };
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (startedAt) setSeconds((Date.now() - startedAt) / 1000);
    setStartedAt(null);
  };

  const result = seconds === null ? null
    : flowRateFromContainer({ amount: Number(amount.replace(',', '.')), unit, seconds });

  const save = async () => {
    setError(null); setMessage(null);
    if (!zone || !result) return;
    if (!result.ok) { setError(result.problem === 'size' ? t('setup.flow.sizeInvalid') : t('setup.flow.timeInvalid')); return; }
    const lpm = result.litresPerMinute;
    try {
      await saveZoneSetup(zone.zoneId, { flowRateLpm: lpm });
      setMessage(t('setup.flow.saved', { zone: zone.name, lpm }));
      setup.reload();
    } catch (e) {
      if (isNetworkError(e)) {
        setup.updateLocal(l => ({ ...l, unsent: addUnsent(l.unsent, { kind: 'flow', zoneId: zone.zoneId, flowRateLpm: lpm }) }));
        setMessage(t('offline.savedForLater'));
      } else {
        setError(e instanceof Error && e.message ? e.message : t('log.failed'));
      }
    }
  };

  const running = startedAt !== null;
  const shown = running ? (now - startedAt) / 1000 : seconds;

  return <>
    <StepIntro styles={styles} title={t('setup.flow.title')} why={t('setup.flow.why')} tip={t('setup.flow.tip')} />
    {zones.length > 1 ? <View style={styles.chips}>
      {zones.map(z => <Pressable key={z.zoneId} accessibilityRole="radio" accessibilityState={{ checked: z.zoneId === zoneId }}
        onPress={() => { setZoneId(z.zoneId); setSeconds(null); setMessage(null); }} style={[styles.chip, z.zoneId === zoneId && styles.chipOn]}>
        <Text style={[styles.chipText, z.zoneId === zoneId && styles.chipTextOn]}>{z.name}{z.hasFlowRate ? ' ✓' : ''}</Text>
      </Pressable>)}
    </View> : null}
    <Text style={styles.help}>{t('setup.flow.how')}</Text>
    <Text style={styles.label}>{t('setup.flow.size')}</Text>
    <TextInput keyboardType="decimal-pad" value={amount} onChangeText={setAmount} style={styles.input}
      accessibilityLabel={t('setup.flow.size')} testID="setup-flow-amount" />
    <View style={styles.chips}>
      {(['L', 'ml'] as const).map(u => <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: unit === u }}
        onPress={() => setUnit(u)} style={[styles.chip, unit === u && styles.chipOn]} testID={`setup-flow-unit-${u}`}>
        <Text style={[styles.chipText, unit === u && styles.chipTextOn]}>{u === 'L' ? t('setup.flow.litres') : t('setup.flow.ml')}</Text>
      </Pressable>)}
    </View>
    <Pressable accessibilityRole="button" onPress={running ? stop : start}
      style={[styles.stopwatch, running && styles.stopwatchRunning]} testID="setup-flow-stopwatch">
      <Text style={styles.stopwatchText}>{running ? t('setup.flow.stop') : seconds === null ? t('setup.flow.start') : t('setup.flow.again')}</Text>
      {shown !== null ? <Text style={styles.stopwatchTime}>{t('setup.flow.seconds', { s: shown.toFixed(1) })}</Text> : null}
    </Pressable>
    {result?.ok ? <Text style={styles.result} testID="setup-flow-result">{t('setup.flow.result', { lpm: result.litresPerMinute })}</Text> : null}
    {seconds !== null && zone ? <Pressable accessibilityRole="button" onPress={() => { void save(); }} style={styles.action} testID="setup-flow-save">
      <Text style={styles.actionText}>{t('setup.flow.save', { zone: zone.name })}</Text>
    </Pressable> : null}
    {message ? <Text style={styles.ok} accessibilityLiveRegion="polite">{message}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite" testID="setup-flow-error">{error}</Text> : null}
  </>;
}

// 6. Soil: a dry reading now and a wet one later, with a meter for how sure AgroFlow is.
function SoilStep({ t, styles, zones }: { t: T; styles: Styles; zones: SetupZone[] }) {
  const withKit = zones.filter(z => z.hasKit);
  return <>
    <StepIntro styles={styles} title={t('setup.soil.title')} why={t('setup.soil.why')} tip={t('setup.soil.tip')} />
    {withKit.length === 0 ? <Text style={styles.help}>{t('setup.soil.noKits')}</Text> : null}
    {zones.map(zone => zone.hasKit
      ? <SoilCard key={zone.zoneId} t={t} styles={styles} zone={zone} />
      : <Text key={zone.zoneId} style={styles.help}>{t('setup.soil.noKit', { zone: zone.name })}</Text>)}
  </>;
}

function SoilCard({ t, styles, zone }: { t: T; styles: Styles; zone: SetupZone }) {
  const { refreshZones } = useAgroFlow();
  const [busy, setBusy] = useState<'wet' | 'dry' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const level = soilConfidence(zone);
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;

  const save = async (point: 'wet' | 'dry') => {
    setBusy(point); setMessage(null); setError(null);
    try {
      const r = await saveZoneCalibration(zone.zoneId, point);
      setMessage(r.message || t('setup.soil.saved'));
      refreshZones();
    } catch (e) {
      // A reading needs the kit to answer now, so this one cannot wait for later.
      setError(isNetworkError(e) ? t('offline.needsConnection')
        : `${e instanceof Error && e.message ? e.message + ' ' : ''}${t('setup.soil.kitOffline')}`);
    } finally {
      setBusy(null);
    }
  };

  return <View style={styles.card} testID={`setup-soil-${zone.zoneId}`}>
    <View style={styles.cardHead}><Text style={styles.cardTitle}>{zone.name}</Text><KitBadge t={t} styles={styles} zone={zone} /></View>
    <Text style={styles.label}>{t('setup.soil.confidence', { level: t(`setup.soil.${level}` as TranslationKey) })}</Text>
    <View style={styles.meter} accessibilityLabel={t('setup.soil.confidence', { level: t(`setup.soil.${level}` as TranslationKey) })}>
      {[1, 2, 3].map(i => <View key={i} style={[styles.meterBar, i <= filled && styles.meterOn]} />)}
    </View>
    <Text style={styles.help}>{t('setup.soil.dryHow')}</Text>
    <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => { void save('dry'); }} style={[styles.action, zone.drySaved && styles.actionDone]}>
      <Text style={styles.actionText}>{zone.drySaved ? `✓ ${t('setup.soil.dry')}` : t('setup.soil.dry')}</Text>
    </Pressable>
    <Text style={styles.help}>{t('setup.soil.wetHow')}</Text>
    <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => { void save('wet'); }} style={[styles.action, zone.wetSaved && styles.actionDone]}>
      <Text style={styles.actionText}>{zone.wetSaved ? `✓ ${t('setup.soil.wet')}` : t('setup.soil.wet')}</Text>
    </Pressable>
    {zone.drySaved && !zone.wetSaved ? <Text style={styles.help}>{t('setup.soil.reminder')}</Text> : null}
    {message ? <Text style={styles.ok} accessibilityLiveRegion="polite">{message}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </View>;
}

// One zone per screen, for the per-zone steps. Zone 2 and after get "Same as Zone 1" when the
// step offers it. After a zone is saved the next one opens by itself.
function useZoneIndex(zones: SetupZone[]) {
  const [index, setIndex] = useState(0);
  const i = Math.min(index, Math.max(zones.length - 1, 0));
  return { i, zone: zones[i] ?? null, next: () => setIndex(v => Math.min(v + 1, zones.length - 1)), go: setIndex };
}

function ZonePager({ t, styles, zones, i, go }: { t: T; styles: Styles; zones: SetupZone[]; i: number; go: (n: number) => void }) {
  if (zones.length < 2) return null;
  return <View style={styles.chips}>
    {zones.map((z, n) => <Pressable key={z.zoneId} accessibilityRole="tab" accessibilityState={{ selected: n === i }}
      onPress={() => go(n)} style={[styles.chip, n === i && styles.chipOn]} testID={`setup-zone-tab-${n}`}>
      <Text style={[styles.chipText, n === i && styles.chipTextOn]}>{z.name}</Text>
    </Pressable>)}
  </View>;
}

function LooksRight({ t, styles, onPress, testID, label }: { t: T; styles: Styles; onPress: () => void; testID: string; label?: string }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action} testID={testID}>
    <Text style={styles.actionText}>{label ?? t('setup.looksRight')}</Text>
  </Pressable>;
}

// 4. Is this your farm? Farmers do not edit the location (staff set it); they confirm it or
// tell their field officer.
function LocationStep({ t, styles, setup, onRight }: { t: T; styles: Styles; setup: ReturnType<typeof useSetup>; onRight: () => void }) {
  const { farm } = useAgroFlow();
  const f = setup.facts.farm;
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPoint = f?.latitude != null && f?.longitude != null;
  const place = [f?.town, f?.province].filter(Boolean).join(', ') || f?.location || t('setup.location.unknown');

  const wrong = async () => {
    setError(null);
    if (!farm) return;
    try {
      const r = await reportLocationProblem(farm.id);
      setup.updateLocal(l => ({ ...l, locationFlagged: true }));
      setSent(r.message || t('setup.location.sent'));
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };

  return <>
    <StepIntro styles={styles} title={t('setup.location.title')} why={t('setup.location.why')} />
    <Text style={styles.cardTitle} testID="setup-location-place">{place}</Text>
    {hasPoint
      ? <View style={styles.mapBox} testID="setup-location-map" accessibilityLabel={t('setup.location.mapA11y', { place })}>
          <FarmMapSurface latitude={f!.latitude!} longitude={f!.longitude!} zoom={13} onFailure={() => undefined} />
        </View>
      : <Text style={styles.help}>{t('setup.location.noPoint')}</Text>}
    {hasPoint ? <Text style={styles.help}>{t('setup.location.coords', { lat: f!.latitude!.toFixed(4), lon: f!.longitude!.toFixed(4) })}</Text> : null}
    {sent ? <Text style={styles.ok} accessibilityLiveRegion="polite" testID="setup-location-sent">{sent}</Text> : <>
      <LooksRight t={t} styles={styles} onPress={onRight} testID="setup-location-right" />
      <Pressable accessibilityRole="button" onPress={() => { void wrong(); }} style={styles.secondaryWide} testID="setup-location-wrong">
        <Text style={styles.secondaryText}>{t('setup.location.wrong')}</Text>
      </Pressable>
    </>}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// 5. Where the water comes from.
function WaterStep({ t, styles, setup, onSaved }: { t: T; styles: Styles; setup: ReturnType<typeof useSetup>; onSaved: (source: WaterSource) => void }) {
  const { farm } = useAgroFlow();
  const current = setup.facts.farm?.waterSource ?? null;
  const [error, setError] = useState<string | null>(null);
  const pick = async (source: WaterSource) => {
    setError(null);
    if (!farm) return;
    try {
      await saveWaterSource(farm.id, source);
      setup.reload();
      onSaved(source);
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  return <>
    <StepIntro styles={styles} title={t('setup.water.title')} why={t('setup.water.why')} />
    {WATER_SOURCES.map(s => <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: current === s }}
      onPress={() => { void pick(s); }} style={[styles.choice, current === s && styles.choiceOn]} testID={`setup-water-${s}`}>
      <Text style={[styles.choiceText, current === s && styles.choiceTextOn]}>{t(`setup.water.${s}` as TranslationKey)}</Text>
    </Pressable>)}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// 6. The tank: size, and how full it is now (a starting level for the tank estimate). Uses the
// existing tank records (0046); a farm without a tank never sees this step.
function TankStep({ t, styles, setup, onSaved }: { t: T; styles: Styles; setup: ReturnType<typeof useSetup>; onSaved: () => void }) {
  const { farm } = useAgroFlow();
  const f = setup.facts.farm;
  const [size, setSize] = useState<number | null>(f?.tankCapacityLitres ?? null);
  const [custom, setCustom] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [ph, setPh] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capacity = size ?? (Number(custom.replace(',', '.')) || null);

  const save = async () => {
    setError(null);
    if (!farm) return;
    if (!capacity || capacity <= 0) { setError(t('setup.tank.needSize')); return; }
    if (level === null) { setError(t('setup.tank.needLevel')); return; }
    const phValue = ph.trim() ? Number(ph.replace(',', '.')) : null;
    if (phValue !== null && !(phValue >= 0 && phValue <= 14)) { setError(t('setup.tank.badPh')); return; }
    setBusy(true);
    try {
      await saveTankCapacity(farm.id, capacity);
      await logTankRefill(farm.id, { litresAdded: tankLitres(capacity, level), waterPh: phValue, refilledAt: new Date().toISOString() });
      setup.reload();
      onSaved();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    } finally {
      setBusy(false);
    }
  };

  return <>
    <StepIntro styles={styles} title={t('setup.tank.title')} why={t('setup.tank.why')} />
    <Text style={styles.label}>{t('setup.tank.size')}</Text>
    <View style={styles.chips}>
      {TANK_SIZES.map(s => <Pressable key={s} accessibilityRole="radio" accessibilityState={{ checked: size === s }}
        onPress={() => { setSize(s); setCustom(''); }} style={[styles.chip, size === s && styles.chipOn]} testID={`setup-tank-size-${s}`}>
        <Text style={[styles.chipText, size === s && styles.chipTextOn]}>{t('setup.tank.litres', { n: s.toLocaleString('en-ZA').replace(/,/g, ' ') })}</Text>
      </Pressable>)}
    </View>
    <TextInput keyboardType="number-pad" value={custom} onChangeText={v => { setCustom(v); setSize(null); }} style={styles.input}
      placeholder={t('setup.tank.custom')} accessibilityLabel={t('setup.tank.custom')} testID="setup-tank-custom" />
    <Text style={styles.label}>{t('setup.tank.howFull')}</Text>
    <View style={styles.chips}>
      {TANK_LEVELS.map(l => <Pressable key={l.key} accessibilityRole="radio" accessibilityState={{ checked: level === l.fraction }}
        onPress={() => setLevel(l.fraction)} style={[styles.chip, level === l.fraction && styles.chipOn]} testID={`setup-tank-level-${l.key}`}>
        <Text style={[styles.chipText, level === l.fraction && styles.chipTextOn]}>{t(`setup.tank.${l.key}` as TranslationKey)}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.label}>{t('setup.tank.ph')}</Text>
    <TextInput keyboardType="decimal-pad" value={ph} onChangeText={setPh} style={styles.input} accessibilityLabel={t('setup.tank.ph')} testID="setup-tank-ph" />
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void save(); }} style={[styles.action, busy && styles.disabled]} testID="setup-tank-save">
      <Text style={styles.actionText}>{t('setup.tank.save')}</Text>
    </Pressable>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite" testID="setup-tank-error">{error}</Text> : null}
  </>;
}

// 8. How the zone is watered: only turns the advice's water need into the amount to apply
// (FAO field application efficiency). The advice itself is not changed.
function IrrigationStep({ t, styles, zones, setup }: { t: T; styles: Styles; zones: SetupZone[]; setup: ReturnType<typeof useSetup> }) {
  const { i, zone, next, go } = useZoneIndex(zones);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = sameAsFirst(zones, 'irrigationType');
  const pick = async (type: IrrigationType) => {
    setError(null); setNote(null);
    if (!zone) return;
    try {
      const r = await saveIrrigationType(zone.zoneId, type);
      setNote(r.explanation);
      setup.reload();
      if (i < zones.length - 1) next();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  if (!zone) return <Text style={styles.help}>{t('setup.zones.none')}</Text>;
  return <>
    <StepIntro styles={styles} title={t('setup.irrigation.title', { zone: zone.name })} why={t('setup.irrigation.why')} />
    <ZonePager t={t} styles={styles} zones={zones} i={i} go={go} />
    {i > 0 && first ? <Pressable accessibilityRole="button" onPress={() => { void pick(first as IrrigationType); }} style={styles.secondaryWide} testID="setup-irrigation-same">
      <Text style={styles.secondaryText}>{t('setup.sameAsFirst', { zone: zones[0].name })}</Text>
    </Pressable> : null}
    <View style={styles.iconGrid}>
      {IRRIGATION_TYPES.map(type => {
        const on = zone.irrigationType === type;
        return <Pressable key={type} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { void pick(type); }}
          style={[styles.iconChoice, on && styles.choiceOn]} testID={`setup-irrigation-${type}`}>
          <Text style={styles.iconGlyph} accessibilityElementsHidden importantForAccessibility="no">{IRRIGATION_ICON[type]}</Text>
          <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{t(`setup.irrigation.${type}` as TranslationKey)}</Text>
        </Pressable>;
      })}
    </View>
    {note ? <Text style={styles.help} accessibilityLiveRegion="polite" testID="setup-irrigation-note">{note}</Text> : null}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// Pictures for the irrigation types, plain characters so they need no image files.
const IRRIGATION_ICON: Record<IrrigationType, string> = {
  drip: '💧', sprinkler: '⛲', micro_sprinkler: '🌦', centre_pivot: '🔄', surface: '〰', hand: '🪣',
};

// 9. Soil type: three types, in plain words. The default (loam) counts once confirmed.
function SoilTypeStep({ t, styles, zones, setup }: { t: T; styles: Styles; zones: SetupZone[]; setup: ReturnType<typeof useSetup> }) {
  const { i, zone, next, go } = useZoneIndex(zones);
  const [error, setError] = useState<string | null>(null);
  const first = sameAsFirst(zones, 'soilType');
  const pick = async (soil: SoilType) => {
    setError(null);
    if (!zone) return;
    try {
      if (soil !== zone.soilType) await saveZoneSoilType(zone.zoneId, soil);
      setup.updateLocal(l => confirm(l, soilTypeKey(zone.zoneId)));
      setup.reload();
      if (i < zones.length - 1) next();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  if (!zone) return <Text style={styles.help}>{t('setup.zones.none')}</Text>;
  return <>
    <StepIntro styles={styles} title={t('setup.soilType.title', { zone: zone.name })} why={t('setup.soilType.why')} />
    <ZonePager t={t} styles={styles} zones={zones} i={i} go={go} />
    {i > 0 && first ? <Pressable accessibilityRole="button" onPress={() => { void pick(first as SoilType); }} style={styles.secondaryWide} testID="setup-soiltype-same">
      <Text style={styles.secondaryText}>{t('setup.sameAsFirst', { zone: zones[0].name })}</Text>
    </Pressable> : null}
    {SOIL_TYPES.map(soil => {
      const on = (zone.soilType ?? 'loam') === soil;
      return <Pressable key={soil} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { void pick(soil); }}
        style={[styles.choice, on && styles.choiceOn]} testID={`setup-soiltype-${soil}`}>
        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{t(`setup.soilType.${soil}` as TranslationKey)}</Text>
        <Text style={styles.help}>{t(`setup.soilType.${soil}Desc` as TranslationKey)}</Text>
      </Pressable>;
    })}
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// 10. Zone size, in square metres or hectares.
function SizeStep({ t, styles, zones, setup }: { t: T; styles: Styles; zones: SetupZone[]; setup: ReturnType<typeof useSetup> }) {
  const { i, zone, next, go } = useZoneIndex(zones);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'m2' | 'ha'>('m2');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(zone?.areaM2 ? String(zone.areaM2) : ''); setUnit('m2'); }, [zone?.zoneId, zone?.areaM2]);
  const save = async (m2: number | null) => {
    setError(null);
    if (!zone) return;
    if (m2 === null) { setError(t('setup.size.invalid')); return; }
    try {
      await saveZoneSetup(zone.zoneId, { areaM2: m2 });
      setup.reload();
      if (i < zones.length - 1) next();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  if (!zone) return <Text style={styles.help}>{t('setup.zones.none')}</Text>;
  const first = sameAsFirst(zones, 'areaM2');
  return <>
    <StepIntro styles={styles} title={t('setup.size.title', { zone: zone.name })} why={t('setup.size.why')} />
    <ZonePager t={t} styles={styles} zones={zones} i={i} go={go} />
    {zone.areaM2 ? <LooksRight t={t} styles={styles} testID="setup-size-right" onPress={() => { void save(zone.areaM2!); }}
      label={`${t('setup.looksRight')} · ${t('setup.size.m2', { n: zone.areaM2 })}`} /> : null}
    {i > 0 && first ? <Pressable accessibilityRole="button" onPress={() => { void save(first as number); }} style={styles.secondaryWide} testID="setup-size-same">
      <Text style={styles.secondaryText}>{t('setup.sameAsFirst', { zone: zones[0].name })}</Text>
    </Pressable> : null}
    <TextInput keyboardType="decimal-pad" value={value} onChangeText={setValue} style={styles.input}
      accessibilityLabel={t('setup.size.label')} testID="setup-size-value" />
    <View style={styles.chips}>
      {(['m2', 'ha'] as const).map(u => <Pressable key={u} accessibilityRole="radio" accessibilityState={{ checked: unit === u }}
        onPress={() => setUnit(u)} style={[styles.chip, unit === u && styles.chipOn]} testID={`setup-size-unit-${u}`}>
        <Text style={[styles.chipText, unit === u && styles.chipTextOn]}>{t(`setup.size.${u}Unit` as TranslationKey)}</Text>
      </Pressable>)}
    </View>
    <Pressable accessibilityRole="button" onPress={() => { void save(areaToM2(Number(value.replace(',', '.')), unit)); }} style={styles.action} testID="setup-size-save">
      <Text style={styles.actionText}>{t('setup.size.save')}</Text>
    </Pressable>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite" testID="setup-size-error">{error}</Text> : null}
  </>;
}

// 13. The maximum run time: set by staff for the pump; read-only for the farmer.
function MaxRunStep({ t, styles, zones, onRight }: { t: T; styles: Styles; zones: SetupZone[]; onRight: () => void }) {
  return <>
    <StepIntro styles={styles} title={t('setup.maxRun.title')} why={t('setup.maxRun.why')} />
    {zones.map(z => <View key={z.zoneId} style={styles.summaryRow} testID={`setup-maxrun-${z.zoneId}`}>
      <Text style={styles.summaryTask}>{z.name}</Text>
      <Text style={styles.summaryState}>{t('setup.maxRun.minutes', { n: z.maxRunMinutes ?? 5 })}</Text>
    </View>)}
    <Text style={styles.help}>{t('setup.maxRun.ask')}</Text>
    <LooksRight t={t} styles={styles} onPress={onRight} testID="setup-maxrun-right" label={t('setup.maxRun.ok')} />
  </>;
}

// 14. Which alerts, and which also on Telegram. In-app is always on.
function AlertsStep({ t, styles, linked, onSaved }: { t: T; styles: Styles; linked: boolean; onSaved: () => void }) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [quiet, setQuiet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchNotificationPreferences().then(p => { setPrefs(p); setQuiet(!!p.quietStart && !!p.quietEnd); }).catch(() => undefined);
  }, []);
  const rows: { key: keyof NotificationPreferences; label: TranslationKey }[] = [
    { key: 'wateringTelegram', label: 'setup.alerts.watering' },
    { key: 'lowTankTelegram', label: 'setup.alerts.lowTank' },
    { key: 'droughtTelegram', label: 'setup.alerts.drought' },
    { key: 'communityTelegram', label: 'setup.alerts.community' },
    { key: 'weatherTelegram', label: 'setup.alerts.weather' },
  ];
  const save = async () => {
    setError(null);
    const next = { ...prefs, quietStart: quiet ? prefs.quietStart ?? '21:00' : null, quietEnd: quiet ? prefs.quietEnd ?? '06:00' : null };
    try {
      await saveNotificationPreferences(next);
      onSaved();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  return <>
    <StepIntro styles={styles} title={t('setup.alerts.title')} why={t('setup.alerts.why')} />
    {rows.map(r => <View key={r.key} style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t(r.label)}</Text>
      {linked
        ? <Switch value={prefs[r.key] as boolean} onValueChange={v => setPrefs(p => ({ ...p, [r.key]: v }))}
            accessibilityLabel={t('setup.alerts.telegramFor', { what: t(r.label) })} testID={`setup-alerts-${r.key}`} />
        : <Text style={styles.help}>{t('setup.alerts.inApp')}</Text>}
    </View>)}
    {!linked ? <Text style={styles.help}>{t('setup.alerts.noTelegram')}</Text> : <>
      <View style={styles.switchRow}>
        <Text style={styles.summaryTask}>{t('setup.alerts.quiet')}</Text>
        <Switch value={quiet} onValueChange={setQuiet} accessibilityLabel={t('setup.alerts.quiet')} testID="setup-alerts-quiet" />
      </View>
      {quiet ? <Text style={styles.help}>{t('setup.alerts.quietHours', { start: prefs.quietStart ?? '21:00', end: prefs.quietEnd ?? '06:00' })}</Text> : null}
    </>}
    <Pressable accessibilityRole="button" onPress={() => { void save(); }} style={styles.action} testID="setup-alerts-save">
      <Text style={styles.actionText}>{t('setup.looksRight')}</Text>
    </Pressable>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// 15. Community alerts: on by default, with the 2-reports-in-36-hours rule explained.
function CommunityStep({ t, styles, onSaved }: { t: T; styles: Styles; onSaved: () => void }) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchNotificationPreferences().then(setPrefs).catch(() => undefined); }, []);
  const save = async (optIn: boolean) => {
    setError(null);
    try {
      await saveNotificationPreferences({ ...prefs, communityOptIn: optIn });
      onSaved();
    } catch (e) {
      setError(isNetworkError(e) ? t('offline.needsConnection') : e instanceof Error && e.message ? e.message : t('log.failed'));
    }
  };
  return <>
    <StepIntro styles={styles} title={t('setup.community.title')} why={t('setup.community.why')} tip={t('setup.community.limit')} />
    <Text style={styles.help}>{t('setup.community.unverified')}</Text>
    <Pressable accessibilityRole="button" onPress={() => { void save(true); }} style={[styles.action, prefs.communityOptIn && styles.actionDone]} testID="setup-community-on">
      <Text style={styles.actionText}>{t('setup.community.on')}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={() => { void save(false); }} style={styles.secondaryWide} testID="setup-community-off">
      <Text style={styles.secondaryText}>{t('setup.community.off')}</Text>
    </Pressable>
    {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
  </>;
}

// 16. Drip and the "?" help icons.
function HelpStep({ t, styles, onRight }: { t: T; styles: Styles; onRight: () => void }) {
  const { preferences, setPreference } = useAppPreferences();
  return <>
    <StepIntro styles={styles} title={t('setup.help.title')} why={t('setup.help.why')} />
    <View style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t('setup.help.drip')}</Text>
      <Switch value={preferences.showRaindropHelper} onValueChange={v => setPreference('showRaindropHelper', v)}
        accessibilityLabel={t('setup.help.drip')} testID="setup-help-drip" />
    </View>
    <View style={styles.switchRow}>
      <Text style={styles.summaryTask}>{t('setup.help.icons')}</Text>
      <Switch value={preferences.showPageHelp} onValueChange={v => setPreference('showPageHelp', v)}
        accessibilityLabel={t('setup.help.icons')} testID="setup-help-icons" />
    </View>
    <LooksRight t={t} styles={styles} onPress={onRight} testID="setup-help-right" />
  </>;
}

// 17. All set: a summary of everything, what is still to do, and each zone's first advice.
function DoneStep({ t, styles, setup }: { t: T; styles: Styles; setup: ReturnType<typeof useSetup> }) {
  const f = setup.facts;
  const all = setupComplete(f);
  const farm = f.farm;
  const tank = farm?.waterSource === 'tank' && farm.tankCapacityLitres
    ? t('setup.done.tank', {
        litres: Math.round(farm.tankCapacityLitres).toLocaleString('en-ZA').replace(/,/g, ' '),
        level: farm.tankRemainingLitres != null ? tankLevelWords(t, farm.tankRemainingLitres / farm.tankCapacityLitres) : t('setup.done.levelUnknown'),
      })
    : farm?.waterSource ? t(`setup.water.${farm.waterSource}` as TranslationKey) : null;
  const pending = SETUP_STEPS.filter(s => s !== 'done' && !stepDone(s, f));
  return <>
    <View style={styles.doneHead}><Drip mood={all ? 'happy' : 'wave'} size={56} /></View>
    <StepIntro styles={styles} title={all ? t('setup.done.title') : t('setup.done.partTitle')} why={t('setup.done.why')} />
    <View style={styles.card} testID="setup-summary">
      {tank ? <Text style={styles.cardTitle} testID="setup-summary-farm">{tank}</Text> : null}
      {f.zones.map(z => <Text key={z.zoneId} style={styles.help} testID={`setup-summary-zone-${z.zoneId}`}>
        {[z.name, z.crop ? cropLabel(z.crop) : null, z.irrigationType ? t(`setup.irrigation.${z.irrigationType}` as TranslationKey).toLowerCase() : null,
          z.soilType ? t(`setup.soilType.${z.soilType}` as TranslationKey).toLowerCase() : null].filter(Boolean).join(' · ')}
      </Text>)}
    </View>
    {pending.length ? <>
      <Text style={styles.label}>{t('setup.done.pending')}</Text>
      {pending.map(task => <View key={task} style={styles.summaryRow} testID={`setup-summary-${task}`}>
        <Text style={styles.summaryTask}>{t(`setup.task.${task}` as TranslationKey)}</Text>
        <Text style={[styles.summaryState, styles.summaryTodo]}>{t('setup.done.todo')}</Text>
      </View>)}
    </> : null}
    {setup.today.map(z => <View key={z.zoneId} style={styles.card}>
      <Text style={styles.label}>{t('setup.done.preview', { zone: z.name })}</Text>
      <Text style={styles.cardTitle}>{z.action.text}</Text>
    </View>)}
  </>;
}

function tankLevelWords(t: T, fraction: number): string {
  const level = fraction >= 0.9 ? 'full' : fraction >= 0.625 ? 'threeQuarters' : fraction >= 0.375 ? 'half' : fraction >= 0.15 ? 'quarter' : 'nearlyEmpty';
  return t(`setup.done.level.${level}` as TranslationKey);
}

function cropLabel(value: string): string {
  return ZONE_CROPS.find(c => c.value === value)?.label ?? value;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    // 320-430 px phones use the full width; wider screens (web, tablets) get a centred column.
    frame: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
    progressHead: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.two },
    progressText: { color: colors.textSecondary, fontSize: Type.caption, fontWeight: '600' },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primaryDark },
    content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: 40 },
    title: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
    why: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 23 },
    label: { color: colors.text, fontSize: Type.body, fontWeight: '600', marginTop: Spacing.one },
    help: { color: colors.textSecondary, fontSize: Type.body, lineHeight: 22 },
    tip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
    tipText: { flex: 1, color: colors.text, fontSize: Type.caption, lineHeight: 20 },
    choice: { minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: Spacing.three, backgroundColor: colors.surface },
    choiceOn: { borderColor: colors.primaryDark, borderWidth: 2 },
    choiceText: { color: colors.text, fontSize: Type.body },
    choiceTextOn: { fontWeight: '700', color: colors.primaryDark },
    input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.three, color: colors.text, fontSize: Type.body, backgroundColor: colors.surface },
    action: { minHeight: 52, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
    actionDone: { backgroundColor: colors.success },
    actionText: { color: colors.white, fontSize: Type.body, fontWeight: '700', textAlign: 'center' },
    ok: { color: colors.success, fontSize: Type.body, lineHeight: 22, fontWeight: '600' },
    error: { color: colors.error, fontSize: Type.body, lineHeight: 22 },
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, backgroundColor: colors.surface },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
    cardTitle: { color: colors.text, fontSize: Type.title, fontWeight: '600', flexShrink: 1 },
    badge: { fontSize: Type.caption, fontWeight: '700', paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
    badgeOn: { color: colors.white, backgroundColor: colors.success },
    badgeOff: { color: colors.text, backgroundColor: colors.warningBackground },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    chip: { minHeight: 48, minWidth: 48, paddingHorizontal: Spacing.three, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    chipOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
    chipText: { color: colors.text, fontSize: Type.body },
    chipTextOn: { color: colors.white, fontWeight: '700' },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
    dateButton: { minHeight: 48, paddingHorizontal: Spacing.two, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
    dateText: { flex: 1, minWidth: 120, textAlign: 'center', color: colors.text, fontSize: Type.body, fontWeight: '600' },
    stopwatch: { minHeight: 120, borderRadius: Radius.md, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
    stopwatchRunning: { backgroundColor: colors.error },
    stopwatchText: { color: colors.white, fontSize: 28, fontWeight: '700' },
    stopwatchTime: { color: colors.white, fontSize: Type.body },
    result: { color: colors.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
    meter: { flexDirection: 'row', gap: Spacing.one },
    meterBar: { flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.divider },
    meterOn: { backgroundColor: colors.primaryDark },
    summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, gap: Spacing.two },
    summaryTask: { color: colors.text, fontSize: Type.body, flex: 1 },
    summaryState: { fontSize: Type.body, fontWeight: '700' },
    summaryOk: { color: colors.success },
    summaryTodo: { color: colors.warning },
    doneHead: { alignItems: 'center' },
    footer: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.four, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, backgroundColor: colors.background },
    primary: { flex: 2, minHeight: 52, borderRadius: Radius.sm, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: colors.white, fontSize: Type.body, fontWeight: '700' },
    secondary: { flex: 1, minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryWide: { minHeight: 52, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: colors.text, fontSize: Type.body, fontWeight: '600' },
    linkButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
    link: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', textDecorationLine: 'underline' },
    disabled: { opacity: 0.5 },
    sectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
    sectionChip: { fontSize: Type.caption, color: colors.textSecondary, paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, overflow: 'hidden' },
    sectionChipOn: { color: colors.white, backgroundColor: colors.primaryDark, borderColor: colors.primaryDark, fontWeight: '700' },
    sectionChipDone: { borderColor: colors.success },
    mapBox: { height: 180, borderRadius: Radius.sm, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
    iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    iconChoice: { width: '47%', minHeight: 96, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: Spacing.one, backgroundColor: colors.surface, padding: Spacing.two },
    iconGlyph: { fontSize: 32 },
    switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  });
}
