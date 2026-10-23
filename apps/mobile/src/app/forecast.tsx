// The 7-day Forecast screen. Reached as /forecast, or
// /forecast?zoneId=123&zoneName=Tunnel%201 for one zone's advice.
// It helps a farmer decide whether to water tomorrow or wait for rain: the weather is the
// evidence and the advice line under each day is the answer. Without a zone it shows only
// the weather, which is what Home links to.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Cloud, CloudRain, Sun } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';

import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { createForecastStyles } from '@/styles/forecastStyles';
import { fetchForecast, type ForecastDay, type ForecastResponse } from '@/services/agroFlowApi';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { t, useI18n } from '@/i18n';

// "3 Oct": short enough to fit under the weekday on a small phone.
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleString('en-ZA', { month: 'short' })}`;
}

export default function ForecastScreen() {
  // Re-renders in the farmer's language; t() below reads the same choice.
  useI18n();
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createForecastStyles(colors), [colors]);
  const { farm } = useAgroFlow();

  const params = useLocalSearchParams<{ zoneId?: string; zoneName?: string }>();
  const zoneId = params.zoneId;
  const zoneName = params.zoneName;

  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The last forecast that loaded for THIS zone or farm, and when (AF-17): shown under an
  // error, labelled as old, instead of an empty screen. Cleared when the zone or farm changes.
  const [lastGoodAt, setLastGoodAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const forKey = `${zoneId ?? ''}|${farm?.id ?? ''}`;
  const keyRef = useRef(forKey);

  const load = useCallback(async () => {
    // One request at a time: repeated taps on Try again do not stack up fetches.
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const fresh = await fetchForecast({
        // Security: the farm is only sent when no zone is named. Otherwise the server takes the
        // farm from the zone, so a farmer cannot pair their farm with someone else's zone.
        ...(zoneId ? { zoneId } : farm?.id ? { farmId: farm.id } : {}),
      });
      setData(fresh);
      setLastGoodAt(Date.now());
      // The error and the "old" label go only after a success.
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t('forecast.loadFailed')
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [zoneId, farm?.id]);

  useEffect(() => {
    // A different zone or farm never shows the previous one's forecast.
    if (keyRef.current !== forKey) {
      keyRef.current = forKey;
      setData(null);
      setLastGoodAt(null);
    }
    void load();
  }, [load, forKey]);

  const renderIcon = (icon: ForecastDay['icon']) => {
    // Colour is never the only signal: the rain figure is written out beside every icon.
    if (icon === 'rain') return <CloudRain size={26} color={colors.primaryDark} strokeWidth={1.8} />;
    if (icon === 'cloud') return <Cloud size={26} color={colors.textSecondary} strokeWidth={1.8} />;
    return <Sun size={26} color={colors.warning} strokeWidth={1.8} />;
  };

  const todayIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
        </Pressable>

        <ScreenHeader
          title={t('forecast.title')}
          subtitle={zoneName ?? data?.zoneName ?? farm?.name ?? undefined}
          help="forecast"
        />

        {error ? (
          <View style={{ gap: 8 }} testID="forecast-error">
            <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: loading, busy: loading }} disabled={loading}
              onPress={() => { void load(); }} testID="forecast-retry"
              style={{ alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' }}>
              {loading ? <ActivityIndicator color={colors.primaryDark} />
                : <Text style={[styles.emptyTitle, { color: colors.primaryDark }]}>{t('common.retry')}</Text>}
            </Pressable>
            {data && lastGoodAt ? <Text style={styles.emptyBody} testID="forecast-stale">
              {t('forecast.showingOld', { time: new Date(lastGoodAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) })}
            </Text> : null}
          </View>
        ) : null}
        {loading && !data ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : error && !data ? null : !data || data.days.length === 0 ? (
          // Says whether there is nothing to show or something is broken; an empty screen looks broken.
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {data?.message ?? t('forecast.none')}
            </Text>
            <Text style={styles.emptyBody}>
              {t('forecast.noneBody')}
            </Text>
          </View>
        ) : (
          <>
            {(zoneId || data.zoneId) && (
              <Text style={styles.zoneNote}>
                What each day means for watering {data.zoneName ?? 'this zone'}.
              </Text>
            )}

            {data.days.map((day, index) => {
              const isToday = day.date === todayIso;
              const wet = day.rainMm !== null && day.rainMm >= 1;

              return (
                <View
                  key={day.date}
                  style={[
                    styles.dayRow,
                    isToday && styles.dayRowToday,
                    index === data.days.length - 1 && styles.dayRowLast,
                  ]}
                  accessibilityLabel={[
                    isToday ? t('forecast.today') : day.weekday,
                    day.minC !== null && day.maxC !== null
                      ? t('forecast.degreesA11y', { min: day.minC, max: day.maxC })
                      : t('forecast.noTemp'),
                    day.rainMm !== null ? t('forecast.rainA11y', { mm: day.rainMm }) : t('forecast.noRain'),
                    day.advice ?? '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <View style={styles.dayLabel}>
                    <Text style={styles.weekday}>{isToday ? t('forecast.today') : day.weekday}</Text>
                    <Text style={styles.dayDate}>{shortDate(day.date)}</Text>
                  </View>

                  <View style={styles.iconCell}>{renderIcon(day.icon)}</View>

                  <View style={styles.dayBody}>
                    <Text style={styles.temps}>
                      {day.minC !== null && day.maxC !== null
                        ? `${day.minC}° to ${day.maxC}°`
                        : t('forecast.noTemp')}
                    </Text>

                    <Text style={wet ? styles.rainWet : styles.rain}>
                      {day.rainMm === null
                        ? t('forecast.noRain')
                        : day.rainMm === 0
                          ? t('forecast.dry')
                          : t('forecast.rainMm', { mm: day.rainMm })}
                    </Text>

                    {/* Only when the engine had something to say. */}
                    {day.advice && <Text style={styles.advice}>{day.advice}</Text>}
                  </View>
                </View>
              );
            })}

            <Text style={styles.source}>{data.source}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
