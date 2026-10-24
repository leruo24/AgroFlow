// The Kit tab: one card per zone. At the top a plain status (Working, Needs attention, Not
// connected, or Awaiting installation for a zone with no kit yet), then a checklist of what is
// working. Every line is the server's reading of what the kit really reports (KitHealth): never a
// battery level, water flow or valve position, which the kit cannot measure. Below it, the kit's
// setup Wi-Fi with a copy button, and Change Wi-Fi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleAlert, CircleCheck, CircleX, Info } from 'lucide-react-native';
import { router } from '@/lib/router';
import { FarmSelector } from '@/components/FarmSelector';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { Card, CardList } from '@/components/ui/Card';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { useI18n, type TranslationKey } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { createScreenStyles } from '@/styles/screenStyles';
import { createIrrigationStyles } from '@/styles/irrigationStyles';
import { copyOrShare, kitLineText } from '@/lib/kitStatus';
import { fetchFarmKits, type KitCard, type KitLine } from '@/services/agroFlowApi';
import type { AppColors } from '@/constants/colors';
import { Platform } from 'react-native';

type State =
  | { status: 'loading' }
  | { status: 'ready'; cards: KitCard[] }
  | { status: 'error'; cards: KitCard[] | null };

export default function KitTabScreen() {
  const { farm } = useAgroFlow();
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
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

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
                <KitCardView key={card.zoneId} card={card} focused={card.zoneId === focusZone} colors={colors} styles={styles} t={t} lang={lang} />)}</CardList>}
          </>}
    </ScrollView>
  </SafeAreaView>;
}

type T = ReturnType<typeof useI18n>['t'];
// The shared screen styles plus the Irrigation tab's buttons.
const kitStyles = (colors: AppColors) => ({ ...createScreenStyles(colors), ...createIrrigationStyles(colors) });
type Styles = ReturnType<typeof kitStyles>;

function toneColor(colors: AppColors, tone: KitLine['tone'] | 'neutral') {
  return tone === 'ok' ? colors.success : tone === 'warn' ? colors.warning : tone === 'bad' ? colors.error : colors.textSecondary;
}

function KitCardView({ card, focused, colors, styles, t, lang }: {
  card: KitCard; focused: boolean; colors: AppColors; styles: Styles; t: T; lang: ReturnType<typeof useI18n>['lang'];
}) {
  const [whenOpen, setWhenOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Awaiting installation is not a fault: no red, a plain next step.
  const tone = card.overall === 'working' ? 'ok' : card.overall === 'needs_attention' ? 'warn' : card.overall === 'not_connected' ? 'bad' : 'neutral';
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? CircleAlert : tone === 'bad' ? CircleX : Info;
  const copyLabel = Platform.OS === 'web' ? t('kitTab.copy') : t('kitTab.copyOrShare');
  const copy = async (what: string, text: string) => {
    const result = await copyOrShare(text);
    if (result === 'copied') { setCopied(what); setTimeout(() => setCopied(null), 2000); }
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
      ? <Text style={[styles.body, { marginTop: 8 }]} testID={`kit-awaiting-${card.zoneId}`}>{t('kitTab.awaitingBody')}</Text>
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
      </>}
  </Card>;
}
