// Reads zone identity + latest sensor readings from Supabase.
// zone_latest_reading (supabase/migrations/0003_csharp_domain.sql) already
// joins zone to the most recent sensor_reading per zone_id/sensor_type, so
// "latest reading per zone" is computed in Postgres, not here.
import { supabase } from './supabaseClient';

export type ZoneLatestReadingRow = {
  zone_id: number;
  farm_id: number | null;
  crop_type: string;
  water_saved: number;
  health_status: string;
  moisture: number | null;
  temperature: number | null;
  humidity: number | null;
  last_reading_at: string | null;
};

export type FarmRow = {
  farm_id: number;
  name: string;
  location: string;
  total_area: number;
};

export async function fetchZoneLatestReadings(): Promise<
  ZoneLatestReadingRow[]
> {
  const { data, error } = await supabase
    .from('zone_latest_reading')
    .select(
      'zone_id, farm_id, crop_type, water_saved, health_status, moisture, temperature, humidity, last_reading_at'
    );

  if (error) throw error;
  return (data ?? []) as ZoneLatestReadingRow[];
}

export async function fetchFarms(): Promise<FarmRow[]> {
  const { data, error } = await supabase
    .from('farm')
    .select('farm_id, name, location, total_area');

  if (error) throw error;
  return (data ?? []) as FarmRow[];
}
