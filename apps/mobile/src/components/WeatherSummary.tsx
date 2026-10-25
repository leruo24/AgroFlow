import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { CloudSun } from 'lucide-react-native';
import type { Farm } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { fetchCurrentWeather, type CurrentWeatherResponse, type WeatherValueSource } from '@/services/agroFlowApi';
import { createWeatherSummaryStyles } from '@/styles/weatherSummaryStyles';
import { DataState } from './DataState';
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

export function weatherSourceKey(source?: WeatherValueSource): TranslationKey {
  return source === 'field_sensor' ? 'weatherWord.fieldSensor'
    : source === 'local_weather' ? 'weatherWord.localWeather'
      : 'weatherWord.valueUnavailable';
}

export function WeatherSummary({ farm }: { farm: Farm }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createWeatherSummaryStyles(colors), [colors]);
  const [data, setData] = useState<CurrentWeatherResponse | null>(null);
  const [state, setState] = useState<'loading' | 'available' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null); setState('loading');
    fetchCurrentWeather(farm.id).then(result => {
      if (!active) return;
      if (!result.current) { setState('failed'); return; }
      setData(result); setState('available');
    }).catch(() => { if (active) setState('failed'); });
    return () => { active = false; };
  }, [farm.id, farm.latitude, farm.longitude, attempt]);
  if (state === 'loading') return <DataState kind="loading" title={t('weatherCard.loading')} />;
  if (state === 'failed' || !data) return <DataState kind="error" title={t('weather.unavailable')} description={t('weatherCard.failed')} onRetry={() => setAttempt(n => n + 1)} />;
  const current = data.current!;
  const temperature = Number.isFinite(current.temperature_2m) ? `${Math.round(current.temperature_2m!)}°C` : t('weatherWord.valueUnavailable');
  const humidity = Number.isFinite(current.relative_humidity_2m) ? `${Math.round(current.relative_humidity_2m!)}%` : t('weatherWord.valueUnavailable');
  const rows = [
    `${t('sensor.humidity')}: ${humidity} — ${t(weatherSourceKey(current.relative_humidity_2m_source))}`,
    current.wind_speed_10m != null ? t('weatherWord.wind', { kmh: Math.round(current.wind_speed_10m) }) : null,
    data.daily?.precipitation_probability_max?.[0] != null ? t('weatherWord.rainChance', { pct: Math.round(data.daily.precipitation_probability_max[0]) }) : null,
  ].filter(Boolean);
  return <View style={styles.container}>
    <View style={styles.headline}><CloudSun size={30} color={colors.textSecondary} /><Text style={styles.temperature}>{temperature}</Text><Text style={styles.condition}>{t(weatherSourceKey(current.temperature_2m_source))}</Text></View>
    {conditionKey(current.weather_code) ? <Text style={styles.detail}>{t(conditionKey(current.weather_code)!)}</Text> : null}
    {rows.length > 0 && <Text style={styles.detail}>{rows.join(' · ')}</Text>}
    {data.field_sensor_fallback ? <Text style={styles.fallback}>{t('weatherWord.sensorFallback')}</Text> : null}
    {!!current.time && <Text style={styles.updated}>{t('weatherWord.updated', { time: current.time.slice(11, 16) })}</Text>}
  </View>;
}
