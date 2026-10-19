// After Irrigate: what the kit really did with the command (docs/irrigate-path.md).
//   Sending…  ->  Kit started watering (its acknowledgement)  ->  Finished (its run report)
// or "Kit didn't respond — check it's online" when nothing came back within 60 s. Polls
// GET /api/farmer/commands/{id}; the server works out the state (CommandState).
import { useEffect, useState } from 'react';

import { fetchCommandStatus, type CommandStatus } from '@/services/agroFlowApi';

export type RunState = 'sent' | 'started' | 'finished' | 'no_response' | 'failed';

export const RUN_POLL_MS = 3000;
// The server's CommandState.AckWait: no acknowledgement in this long is "didn't respond".
export const ACK_WAIT_MS = 60_000;
// After the run's own length, how long to keep waiting for its report before stopping.
export const FINISH_GRACE_MS = 3 * 60_000;

const DONE: RunState[] = ['finished', 'failed', 'no_response'];

export function runStateFrom(status: CommandStatus | null, sentAt: number, now: number): RunState {
  if (!status) return now - sentAt > ACK_WAIT_MS ? 'no_response' : 'sent';
  const state = status.state as RunState;
  return ['sent', 'started', 'finished', 'no_response', 'failed'].includes(state) ? state : 'sent';
}

export function useRunStatus(commandId: string | null, durationSeconds: number): RunState | null {
  const [state, setState] = useState<RunState | null>(null);

  useEffect(() => {
    if (!commandId) { setState(null); return; }
    let cancelled = false;
    const sentAt = Date.now();
    const giveUpAt = sentAt + durationSeconds * 1000 + FINISH_GRACE_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState('sent');

    const poll = async () => {
      let status: CommandStatus | null = null;
      try { status = await fetchCommandStatus(commandId); } catch { /* try again next time */ }
      if (cancelled) return;
      const next = runStateFrom(status, sentAt, Date.now());
      setState(next);
      // A started run that never reports back keeps saying "started"; polling stops anyway.
      if (DONE.includes(next) || Date.now() > giveUpAt) return;
      timer = setTimeout(poll, RUN_POLL_MS);
    };

    timer = setTimeout(poll, RUN_POLL_MS);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [commandId, durationSeconds]);

  return state;
}
