// Whether this zone has a kit that can hear Water now: enrolled and heard from in the last
// 5 minutes (the server's rule, from GET /api/farmer/zones/{id}/hardware). Checked when the
// screen opens and every minute after. The server refuses a start the same way (409), so
// this only saves the farmer a tap that cannot work.
import { useEffect, useState } from 'react';

import { fetchZoneHardware } from '@/services/agroFlowApi';

// 'unknown': not checked yet, or the check failed (no connection). The button is not
// blocked on a guess; the connectivity check and the server cover those cases.
export type ZoneKitState = 'unknown' | 'none' | 'offline' | 'online';

export const KIT_RECHECK_MS = 60_000;

export function kitStateFrom(hardware: { hardwareId: number | null; deviceId: string | null; online: boolean } | null): ZoneKitState {
  if (!hardware || hardware.hardwareId === null || hardware.deviceId === null) return 'none';
  return hardware.online ? 'online' : 'offline';
}

export function useZoneKit(zoneId: string | number | null | undefined): ZoneKitState {
  const [state, setState] = useState<ZoneKitState>('unknown');

  useEffect(() => {
    const id = Number(zoneId);
    if (!Number.isFinite(id) || id <= 0) return;
    let cancelled = false;

    const check = () => {
      fetchZoneHardware(id)
        .then(hardware => { if (!cancelled) setState(kitStateFrom(hardware)); })
        .catch((error: unknown) => {
          // A 404 means the zone has no kit row the farmer can see.
          const status = (error as { status?: number } | null)?.status;
          if (!cancelled) setState(status === 404 ? 'none' : 'unknown');
        });
    };

    check();
    const timer = setInterval(check, KIT_RECHECK_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [zoneId]);

  return state;
}
