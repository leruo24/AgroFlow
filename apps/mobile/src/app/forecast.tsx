// The 7-day Forecast screen. Reached as /forecast, or
// /forecast?zoneId=123&zoneName=Tunnel%201 for one zone's advice.
//
// WHAT THIS SCREEN IS FOR
// A farmer deciding whether to water tomorrow, or wait for the rain. The
// weather numbers are the evidence; the one-line advice under each day is the
// answer, and it is the reason the screen exists. Opened without a zone it is
// just the weather - which is still useful, and is what Home links to.
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
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { createForecastStyles } from '@/styles/forecastStyles';
import { fetchForecast, type ForecastDay, type ForecastResponse } from '@/services/agroFlowApi';

// "3 Oct" - short enough to sit under the weekday without wrapping on a
// small phone.
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleString('en-ZA', { month: 'short' })}`;
}

export default function ForecastScreen() {
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
          // The farm is only sent when no zone is named - the server resolves
          // the farm FROM the zone otherwise, so a farmer cannot pair their
          // own farm with someone else's zone.
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
    // Colour is never the only signal - the rain figure is spelled out in
    // words on its own line beside every icon.
    if (icon === 'rain') return <CloudRain size={26} color={colors.primaryDark} strokeWidth={1.8} />;
    if (icon === 'cloud') return <Cloud size={26} color={colors.textSecondary} strokeWidth={1.8} />;
    return <Sun size={26} color={colors.warning} strokeWidth={1.8} />;
  };

  const todayIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
          // Says which of "nothing to show" and "something is broken" it is.
          // An empty screen reads as the second even when it is the first.
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

                    {/* Only when the engine actually had something to say. */}
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
