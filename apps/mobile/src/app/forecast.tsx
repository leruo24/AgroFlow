// The 7-day Forecast screen. Reached as /forecast, or
// /forecast?zoneId=123&zoneName=Tunnel%201 for one zone's advice.
// It helps a farmer decide whether to water tomorrow or wait for rain: the weather is the
// evidence and the advice line under each day is the answer. Without a zone it shows only
// the weather, which is what Home links to.
import { useCallback, useEffect, useMemo, useState } from 'react';
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

// "3 Oct": short enough to fit under the weekday on a small phone.
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleString('en-ZA', { month: 'short' })}`;
}

export default function ForecastScreen() {
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

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(
        await fetchForecast({
          // Security: the farm is only sent when no zone is named. Otherwise the server takes the
          // farm from the zone, so a farmer cannot pair their farm with someone else's zone.
          ...(zoneId ? { zoneId } : farm?.id ? { farmId: farm.id } : {}),
        })
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'The forecast could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [zoneId, farm?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
          accessibilityLabel="Go back"
          hitSlop={8}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
        </Pressable>

        <ScreenHeader
          title="The week ahead"
          subtitle={zoneName ?? data?.zoneName ?? farm?.name ?? undefined}
          help="forecast"
        />

        {loading ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !data || data.days.length === 0 ? (
          // Says whether there is nothing to show or something is broken; an empty screen looks broken.
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {data?.message ?? 'Forecast not available right now'}
            </Text>
            <Text style={styles.emptyBody}>
              We get the weather for your area a few times a day. If this keeps saying the same
              thing, check that your farm has its location set.
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
                    isToday ? 'Today' : day.weekday,
                    day.minC !== null && day.maxC !== null
                      ? `${day.minC} to ${day.maxC} degrees`
                      : 'temperature not known',
                    day.rainMm !== null ? `${day.rainMm} millimetres of rain` : 'rain not known',
                    day.advice ?? '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <View style={styles.dayLabel}>
                    <Text style={styles.weekday}>{isToday ? 'Today' : day.weekday}</Text>
                    <Text style={styles.dayDate}>{shortDate(day.date)}</Text>
                  </View>

                  <View style={styles.iconCell}>{renderIcon(day.icon)}</View>

                  <View style={styles.dayBody}>
                    <Text style={styles.temps}>
                      {day.minC !== null && day.maxC !== null
                        ? `${day.minC}° to ${day.maxC}°`
                        : 'Temperature not known'}
                    </Text>

                    <Text style={wet ? styles.rainWet : styles.rain}>
                      {day.rainMm === null
                        ? 'Rain not known'
                        : day.rainMm === 0
                          ? 'No rain expected'
                          : `${day.rainMm} mm rain`}
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
