/* How one irrigation_event reads in the History tab.
 * A watering the farmer logged by hand (logged_by_profile_id, migration 0042) is labelled
 * as such, and shown in litres when that is what they entered, never as a pump run. */
export type EventTextInput = {
  runtime_seconds: number | string | null;
  estimated_litres?: number | string | null;
  trigger_source?: string | null;
  logged_by_profile_id?: string | null;
};

export function describeEvent(event: EventTextInput): { action: string; description: string; source: string } {
  const minutes = event.runtime_seconds == null ? null : Math.round(Number(event.runtime_seconds) / 60);
  const litres = event.estimated_litres == null ? null : Math.round(Number(event.estimated_litres));

  if (event.logged_by_profile_id) {
    const amount = minutes ? `for about ${minutes} minutes` : litres ? `about ${litres} L` : '';
    return {
      action: 'Watering logged by hand',
      description: amount ? `You logged watering ${amount}.` : 'You logged a watering.',
      source: 'Entered by hand',
    };
  }

  // A row here is the kit's own report of a run that has ended, so it says "finished".
  // "Started" is a different thing: the kit's acknowledgement of a command (zone screen).
  const length = event.runtime_seconds == null ? null
    : Number(event.runtime_seconds) < 60 ? `${Math.round(Number(event.runtime_seconds))} seconds`
    : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return {
    action: 'Watering finished',
    description: length == null ? 'The kit reported a finished run.' : `The kit watered for ${length} and stopped.`,
    source: event.trigger_source || 'Irrigation',
  };
}
