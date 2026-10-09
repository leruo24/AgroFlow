import type { DemoAction, DemoState } from "../engine/demoReducer";

export function RecommendationCard({ state, dispatch }: { state: DemoState; dispatch: React.Dispatch<DemoAction> }) {
  const runtime = Math.round(state.selectedWaterLitres / 20);
  const ready = state.phase === "RECOMMENDATION";

  return (
    <section className="experience-card experience-recommendation" aria-labelledby="experienceRecommendationHeading">
      <span className="experience-kicker">Water today</span>
      <h2 id="experienceRecommendationHeading">Apply about <b>{Math.round(state.selectedWaterLitres / 200)} mm</b></h2>
      <div className="experience-amounts" aria-label="Recommended irrigation amount">
        <strong>≈ {state.selectedWaterLitres.toLocaleString("en-US")} L</strong>
        <span>≈ {runtime} min at 20 L/min</span>
      </div>
      <p>Expected rain is not enough to cover the current deficit.</p>

      <button type="button" className="experience-primary" disabled={!ready} onClick={() => dispatch({ type: "START_IRRIGATION" })}>
        {ready ? "Irrigate" : "Preparing recommendation…"}
      </button>
      <div className="experience-card-links">
        <button type="button" className="experience-text-button" aria-expanded={state.whyOpen} onClick={() => dispatch({ type: "TOGGLE_WHY" })}>See why</button>
        <button type="button" className="experience-text-button" aria-expanded={state.adjustmentOpen} onClick={() => dispatch({ type: "TOGGLE_ADJUST" })}>Other options</button>
      </div>

      {state.adjustmentOpen && (
        <div className="experience-options" data-testid="farmer-options">
          <strong>Other options</strong>
          <label htmlFor="experienceTarget">Adjust amount · {state.selectedWaterLitres.toLocaleString("en-US")} L</label>
          <input
            id="experienceTarget"
            type="range"
            min="400"
            max="2400"
            step="100"
            value={state.selectedWaterLitres}
            onChange={(event) => dispatch({ type: "SET_TARGET", litres: Number(event.currentTarget.value) })}
          />
          <div>
            <button type="button" onClick={() => dispatch({ type: "SET_TARGET", litres: 1200 })}>Adjust to 1,200 L</button>
            <button type="button" onClick={() => dispatch({ type: "POSTPONE" })}>Postpone</button>
            <button type="button" onClick={() => dispatch({ type: "SKIP" })}>Skip</button>
          </div>
        </div>
      )}
    </section>
  );
}
