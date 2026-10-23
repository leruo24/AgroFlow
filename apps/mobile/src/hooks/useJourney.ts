// The farm's journey from the server (GET /api/farmer/farms/{id}/journey): "Your details: X of 4",
// "Installation: <stage>", "Where you are now" and each zone's commissioning. Kept with the farm
// it belongs to, so another farm's journey is never shown, and 'loading' until it arrives (no
// false "0 of 4"). 'unavailable' means the server has no journey yet (migration 0058 not applied);
// the old setup card is shown then.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ApiHttpError, fetchJourney, type Journey } from '@/services/agroFlowApi';
import { onReconnect } from '@/lib/connectivity';

export type JourneyState =
  | { status: 'loading'; journey: null }
  | { status: 'ready'; journey: Journey }
  | { status: 'error'; journey: Journey | null }
  | { status: 'unavailable'; journey: null };

export function useJourney(): JourneyState & { reload: () => void; setJourney: (j: Journey) => void } {
  const { farm } = useAgroFlow();
  const farmId = farm?.id ?? null;
  const [state, setState] = useState<{ farmId: string | null; value: JourneyState }>({ farmId: null, value: { status: 'loading', journey: null } });

  const reload = useCallback(() => {
    if (!farmId) return;
    fetchJourney(farmId)
      .then(journey => setState({ farmId, value: { status: 'ready', journey } }))
      .catch(error => setState(current => ({
        farmId,
        value: error instanceof ApiHttpError && error.status === 409
          ? { status: 'unavailable', journey: null }
          : { status: 'error', journey: current.farmId === farmId ? current.value.journey : null },
      })));
  }, [farmId]);

  useEffect(() => { reload(); }, [reload]);
  useFocusEffect(reload);
  useEffect(() => onReconnect(reload), [reload]);

  const setJourney = useCallback((journey: Journey) => { if (farmId) setState({ farmId, value: { status: 'ready', journey } }); }, [farmId]);
  const value: JourneyState = state.farmId === farmId ? state.value : { status: 'loading', journey: null };
  return { ...value, reload, setJourney };
}
