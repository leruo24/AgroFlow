import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { CloudSun } from 'lucide-react-native';
import type { Farm } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { fetchCurrentWeather, type CurrentWeatherResponse } from '@/services/agroFlowApi';
import { createWeatherSummaryStyles } from '@/styles/weatherSummaryStyles';
import { DataState } from './DataState';
import { hasCoordinates } from './FarmLocationMap';
import { useI18n, type TranslationKey } from '@/i18n';

// RET-06: the weather words are catalogue keys (weatherWord.*), so they follow the app language.
export function conditionKey(code?: number): TranslationKey | null {
  if (code == null) return null;
  if (code === 0) return 'weatherWord.clear';
  if (code <= 2) return 'weatherWord.partlyCloudy';
  if (code === 3) return 'weatherWord.cloudy';
  if (code === 45 || code === 48) return 'weatherWord.fog';
  if (code >= 51 && code <= 67) return 'weatherWord.rain';
  if (code >= 71 && code <= 77) return 'weatherWord.snow';
  if (code >= 80 && code <= 82) return 'weatherWord.showers';
  if (code >= 95) return 'weatherWord.thunder';
  return 'weatherWord.unavailable';
}
export function WeatherSummary({ farm }: { farm: Farm }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createWeatherSummaryStyles(colors), [colors]);
  const [data, setData] = useState<CurrentWeatherResponse | null>(null);
  const [state, setState] = useState<'loading' | 'available' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const valid = hasCoordinates(farm);
  useEffect(() => {
    let active = true;
    if (!valid) return;
    setData(null); setState('loading');
    fetchCurrentWeather(farm.id).then(result => {
      if (!active) return;
      if (!result.current || !Number.isFinite(result.current.temperature_2m)) { setState('failed'); return; }
      setData(result); setState('available');
    }).catch(() => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [farm.id, farm.latitude, farm.longitude, valid, attempt]);
  if (!valid) return <DataState kind="empty" title={t('weatherCard.noLocation')} description={t('weatherCard.noLocationBody')} />;
  if (state === 'loading') return <DataState kind="loading" title={t('weatherCard.loading')} />;
  if (state === 'failed' || !data) return <DataState kind="error" title={t('weather.unavailable')} description={t('weatherCard.failed')} onRetry={() => setAttempt(n => n + 1)} />;
  const current = data.current!;
  const rows = [
    current.relative_humidity_2m != null ? t('weatherWord.humidity', { pct: Math.round(current.relative_humidity_2m) }) : null,
    current.wind_speed_10m != null ? t('weatherWord.wind', { kmh: Math.round(current.wind_speed_10m) }) : null,
    data.daily?.precipitation_probability_max?.[0] != null ? t('weatherWord.rainChance', { pct: Math.round(data.daily.precipitation_probability_max[0]) }) : null,
  ].filter(Boolean);
  return <View style={styles.container}>
    <View style={styles.headline}><CloudSun size={30} color={colors.textSecondary} /><Text style={styles.temperature}>{Math.round(current.temperature_2m!)}°C</Text><Text style={styles.condition}>{conditionKey(current.weather_code) ? t(conditionKey(current.weather_code)!) : null}</Text></View>
    {rows.length > 0 && <Text style={styles.detail}>{rows.join(' · ')}</Text>}
    {!!current.time && <Text style={styles.updated}>{t('weatherWord.updated', { time: current.time.slice(11, 16) })}</Text>}
  </View>;
}
