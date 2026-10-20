// Everything the setup wizard and Home's "Setup 4/6 done" card need, from one place:
//   - the farm's zones (AgroFlowContext) and what the server says each one still lacks
//     (GET /api/farmer/farms/{id}/today -> setup facts: crop, planting date, flow rate, kit)
//   - whether Telegram is linked, and whether the password must still be changed
//   - what is kept on the phone (lib/setupProgress.ts), including entries made without a
//     signal, which are sent here once the connection is back.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useAuth } from '@/context/AuthContext';
import { changeZoneCrop, fetchFarmToday, fetchTelegramLinkStatus, saveZoneSetup, type TodayZone } from '@/services/agroFlowApi';
import { isNetworkError, onReconnect } from '@/lib/connectivity';
import {
  EMPTY_LOCAL,
  loadSetupLocal,
  saveSetupLocal,
  type SetupFacts,
  type SetupLocal,
  type SetupZone,
  type UnsentSetup,
} from '@/lib/setupProgress';

export type UseSetup = {
  ready: boolean;
  facts: SetupFacts;
  local: SetupLocal;
  today: TodayZone[];
  updateLocal: (change: (current: SetupLocal) => SetupLocal) => void;
  reload: () => void;
};

export function useSetup(): UseSetup {
  const { farm, zones } = useAgroFlow();
  const { user, mustChangePassword } = useAuth();
  const userId = user?.id ?? null;

  const [local, setLocal] = useState<SetupLocal>(EMPTY_LOCAL);
  const [localReady, setLocalReady] = useState(false);
  const [today, setToday] = useState<TodayZone[]>([]);
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLocalReady(false);
    void loadSetupLocal(userId).then(value => {
      if (!active) return;
      setLocal(value);
      setLocalReady(true);
    });
    return () => { active = false; };
  }, [userId]);

  const updateLocal = useCallback((change: (current: SetupLocal) => SetupLocal) => {
    setLocal(current => {
      const next = change(current);
      void saveSetupLocal(userId, next);
      return next;
    });
  }, [userId]);

  const reload = useCallback(() => setReloadCount(n => n + 1), []);

  useEffect(() => {
    let active = true;
    if (farm) {
      fetchFarmToday(farm.id).then(r => { if (active) setToday(r.zones); }).catch(() => undefined);
    }
    fetchTelegramLinkStatus().then(s => { if (active) setTelegramLinked(s.linked); }).catch(() => undefined);
    return () => { active = false; };
  }, [farm, reloadCount]);

  // Entries made with no signal go out once there is one; anything still offline stays.
  const sendUnsent = useCallback(async () => {
    if (local.unsent.length === 0) return;
    const left: UnsentSetup[] = [];
    for (const entry of local.unsent) {
      try {
        if (entry.kind === 'flow') await saveZoneSetup(entry.zoneId, { flowRateLpm: entry.flowRateLpm });
        else await changeZoneCrop(entry.zoneId, { cropType: entry.cropType, plantingDate: entry.plantingDate });
      } catch (error) {
        if (isNetworkError(error)) left.push(entry);
      }
    }
    if (left.length !== local.unsent.length) {
      updateLocal(current => ({ ...current, unsent: left }));
      reload();
    }
  }, [local.unsent, updateLocal, reload]);

  useEffect(() => { if (localReady) void sendUnsent(); }, [localReady]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onReconnect(() => { void sendUnsent(); }), [sendUnsent]);

  const setupZones = useMemo<SetupZone[]>(() => zones.map(zone => {
    const id = Number(zone.id);
    const facts = today.find(t => t.zoneId === id)?.setup;
    const unsentCrop = local.unsent.find(u => u.kind === 'crop' && u.zoneId === id);
    const unsentFlow = local.unsent.some(u => u.kind === 'flow' && u.zoneId === id);
    const crop = unsentCrop?.kind === 'crop' ? unsentCrop.cropType
      : zone.crop && zone.crop !== 'Not configured' ? zone.crop : null;
    return {
      zoneId: id,
      name: zone.name,
      crop,
      plantingDate: unsentCrop?.kind === 'crop' ? unsentCrop.plantingDate : zone.plantingDate,
      hasFlowRate: unsentFlow || facts?.flowRate === true,
      hasKit: facts?.hasKit === true,
      wetSaved: zone.sensors.soilMoisture.wetSaved === true,
      drySaved: zone.sensors.soilMoisture.drySaved === true,
    };
  }), [zones, today, local.unsent]);

  const facts: SetupFacts = {
    languageConfirmed: local.languageConfirmed,
    mustChangePassword,
    telegramLinked,
    telegramDeclined: local.telegramDeclined,
    zones: setupZones,
  };

  return { ready: localReady, facts, local, today, updateLocal, reload };
}
