// Everything the setup wizard and Home's "Setup X/17 done" card need, from one place:
//   - the farm's zones (AgroFlowContext) and what the server says each one still lacks
//     (GET /api/farmer/farms/{id}/today -> setup facts: crop, planting date, flow rate, kit)
//   - the farm's own settings (GET /api/farmer/farms/{id}/setup: location set by staff, water
//     source, tank, and per zone the irrigation type, soil, size and maximum run time)
//   - whether Telegram is linked, and whether the password must still be changed
//   - what is kept on the phone (lib/setupProgress.ts), including entries made without a
//     signal, which are sent here once the connection is back.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useAuth } from '@/context/AuthContext';
import {
  changeZoneCrop, fetchFarmSetup, fetchFarmToday, fetchTelegramLinkStatus, saveZoneSetup,
  type FarmSetup, type TodayZone,
} from '@/services/agroFlowApi';
import { isNetworkError, onReconnect } from '@/lib/connectivity';
import {
  EMPTY_LOCAL,
  NO_FARM,
  loadSetupLocal,
  saveSetupLocal,
  type IrrigationType,
  type SetupFacts,
  type SetupFarm,
  type SetupLocal,
  type SetupZone,
  type UnsentSetup,
  type WaterSource,
} from '@/lib/setupProgress';

export type UseSetup = {
  ready: boolean;
  facts: SetupFacts;
  local: SetupLocal;
  today: TodayZone[];
  farmSetup: FarmSetup | null;
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
  const [farmSetup, setFarmSetup] = useState<FarmSetup | null>(null);
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
      fetchFarmSetup(farm.id).then(r => { if (active) setFarmSetup(r); }).catch(() => undefined);
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
    const server = farmSetup?.zones.find(z => z.zoneId === id);
    const unsentCrop = local.unsent.find(u => u.kind === 'crop' && u.zoneId === id);
    const unsentFlow = local.unsent.some(u => u.kind === 'flow' && u.zoneId === id);
    const crop = unsentCrop?.kind === 'crop' ? unsentCrop.cropType
      : zone.crop && zone.crop !== 'Not configured' ? zone.crop : null;
    return {
      zoneId: id,
      name: zone.name,
      crop,
      plantingDate: unsentCrop?.kind === 'crop' ? unsentCrop.plantingDate : zone.plantingDate,
      hasFlowRate: unsentFlow || facts?.flowRate === true || (server?.flowRateLpm ?? 0) > 0,
      hasKit: facts?.hasKit === true,
      wetSaved: zone.sensors.soilMoisture.wetSaved === true,
      drySaved: zone.sensors.soilMoisture.drySaved === true,
      irrigationType: (server?.irrigationType ?? null) as IrrigationType | null,
      soilType: server?.soilType ?? null,
      areaM2: server?.areaM2 ?? null,
      maxRunMinutes: server?.maxRunMinutes ?? zone.maxRunMinutes ?? 5,
    };
  }), [zones, today, farmSetup, local.unsent]);

  const setupFarm: SetupFarm = farmSetup?.farm ? {
    latitude: farmSetup.farm.latitude,
    longitude: farmSetup.farm.longitude,
    province: farmSetup.farm.province,
    town: farmSetup.farm.town,
    location: farmSetup.farm.location,
    waterSource: (farmSetup.farm.waterSource ?? null) as WaterSource | null,
    tankCapacityLitres: farmSetup.tank?.capacityLitres ?? null,
    tankRemainingLitres: farmSetup.tank?.estimatedRemainingLitres ?? null,
  } : NO_FARM;

  const facts: SetupFacts = {
    languageConfirmed: local.languageConfirmed,
    mustChangePassword,
    telegramLinked,
    telegramDeclined: local.telegramDeclined,
    zones: setupZones,
    farm: setupFarm,
    confirmed: local.confirmed,
    locationFlagged: local.locationFlagged,
  };

  return { ready: localReady, facts, local, today, farmSetup, updateLocal, reload };
}
