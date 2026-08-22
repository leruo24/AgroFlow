// Talks to the irrigation_commands table the ESP32 firmware polls
// (see hardware/esp32/AgroFlowIrrigationNode). zoneId here must be the real
// Postgres zone.id (bigint) - not the mock Zone.id strings ('zone-1') the
// rest of the app still uses. See AgroFlowContext's dbZoneId field.
import { supabase } from './supabaseClient';

export async function startIrrigationCommand(
  zoneId: number,
  durationMinutes: number | null
): Promise<void> {
  const durationSeconds =
    durationMinutes == null ? null : Math.round(durationMinutes * 60);

  const { error } = await supabase.from('irrigation_commands').insert({
    zone_id: zoneId,
    command: 'start',
    duration_seconds: durationSeconds,
  });

  if (error) throw error;
}

export async function stopIrrigationCommand(
  zoneId: number
): Promise<void> {
  const { error } = await supabase.from('irrigation_commands').insert({
    zone_id: zoneId,
    command: 'stop',
  });

  if (error) throw error;
}
