import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { CloudSun } from 'lucide-react-native';
import type { Farm } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { fetchCurrentWeather, type CurrentWeatherResponse } from '@/services/agroFlowApi';
import { createWeatherSummaryStyles } from '@/styles/weatherSummaryStyles';
import { DataState } from './DataState';
import { hasCoordinates } from './FarmLocationMap';

function condition(code?: number) {
  if (code == null) return null;
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Conditions unavailable';
}
export function WeatherSummary({ farm }: { farm: Farm }) {
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
  if (!valid) return <DataState kind="empty" title="Weather needs a farm location" description="Weather will be available once this farm has coordinates." />;
  if (state === 'loading') return <DataState kind="loading" title="Loading weather" />;
  if (state === 'failed' || !data) return <DataState kind="error" title="Weather unavailable" description="We couldn’t retrieve the latest weather for this farm." onRetry={() => setAttempt(n => n + 1)} />;
  const current = data.current!;
  const rows = [
    current.relative_humidity_2m != null ? `Humidity ${Math.round(current.relative_humidity_2m)}%` : null,
    current.wind_speed_10m != null ? `Wind ${Math.round(current.wind_speed_10m)} km/h` : null,
    data.daily?.precipitation_probability_max?.[0] != null ? `Rain chance ${Math.round(data.daily.precipitation_probability_max[0])}%` : null,
  ].filter(Boolean);
  return <View style={styles.container}>
    <View style={styles.headline}><CloudSun size={30} color={colors.textSecondary} /><Text style={styles.temperature}>{Math.round(current.temperature_2m!)}°C</Text><Text style={styles.condition}>{condition(current.weather_code)}</Text></View>
    {rows.length > 0 && <Text style={styles.detail}>{rows.join(' · ')}</Text>}
    {!!current.time && <Text style={styles.updated}>Updated {current.time.slice(11, 16)}</Text>}
  </View>;
}
