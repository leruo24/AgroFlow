import { useEffect, useMemo, useReducer, useRef } from "react";
import { SCENARIOS } from "../data/scenarios";
import { createInitialState, demoReducer } from "../engine/demoReducer";
import { FieldScene } from "../three/FieldScene";
import { RecommendationCard } from "./RecommendationCard";

interface ExperienceProps {
  onClose: () => void;
}

export function ExperienceAgroFlow({ onClose }: ExperienceProps) {
  const [state, dispatch] = useReducer(demoReducer, undefined, () =>
    demoReducer(
      demoReducer(createInitialState("HOT_DRY"), { type: "INTRO_COMPLETE" }),
      { type: "SHOW_RECOMMENDATION" },
    ),
  );
  const startedAt = useRef(0);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const progress = state.selectedWaterLitres > 0 ? state.waterAppliedLitres / state.selectedWaterLitres : 0;
  const scenario = SCENARIOS.HOT_DRY;
  const recommendationVisible = ["INTRO", "READY", "RECOMMENDATION"].includes(state.phase);
  const irrigationVisible = state.phase === "IRRIGATION_STARTING" || state.phase === "IRRIGATING";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    if (state.phase === "INTRO") {
      const timer = window.setTimeout(() => dispatch({ type: "INTRO_COMPLETE" }), reducedMotion ? 150 : 500);
      return () => window.clearTimeout(timer);
    }
    if (state.phase === "READY") {
      const timer = window.setTimeout(() => dispatch({ type: "SHOW_RECOMMENDATION" }), reducedMotion ? 150 : 550);
      return () => window.clearTimeout(timer);
    }
    if (state.phase === "IRRIGATION_STARTING") {
      const controllerReady = state.controllerStatus === "ACTIVE";
      const timer = window.setTimeout(
        () => dispatch({ type: controllerReady ? "BEGIN_IRRIGATION" : "CONTROLLER_READY" }),
        reducedMotion ? 220 : controllerReady ? 650 : 700,
      );
      return () => window.clearTimeout(timer);
    }
    if (state.phase === "IRRIGATING") {
      startedAt.current = performance.now();
      const duration = reducedMotion ? 3200 : 9000;
      const timer = window.setInterval(() => {
        dispatch({ type: "TICK", progress: Math.min(1, (performance.now() - startedAt.current) / duration) });
      }, 120);
      return () => window.clearInterval(timer);
    }
    if (state.phase === "PLAN_RECALCULATING") {
      const timer = window.setTimeout(() => dispatch({ type: "FINISH_RECALCULATION" }), reducedMotion ? 900 : 2800);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [reducedMotion, state.controllerStatus, state.phase]);

  const exploreTechnology = () => {
    onClose();
    window.setTimeout(() => document.querySelector("#technology")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" }), 0);
  };

  return (
    <div className="experience-shell" role="dialog" aria-modal="true" aria-labelledby="experienceTitle" data-testid="experience-dialog">
      <a className="experience-skip-link" href="#experienceCard">Skip to recommendation</a>

      <section className="experience-stage" aria-label="Interactive view of North Field">
        <FieldScene
          pumpRunning={state.pumpRunning}
          relayOn={state.relayOn}
          controllerActive={state.controllerStatus === "ACTIVE"}
          progress={progress}
          moisture={state.relativeMoisture}
          cameraMode={state.cameraMode}
          viewMode="FIELD"
          rainExpected={state.forecastRainMm >= 15}
          reducedMotion={reducedMotion}
        />

        <header className="experience-brand">
          <img src="brand/agroflow-icon-192.png" width="38" height="38" alt="" />
          <div>
            <strong id="experienceTitle">Experience AgroFlow</strong>
            <span>See how AgroFlow turns field data into an irrigation decision.</span>
          </div>
        </header>
        <button type="button" className="experience-close" onClick={onClose} aria-label="Close Experience AgroFlow">×</button>

        <div className="experience-field-label" aria-label="Demo field details">
          <strong>North Field</strong><span>Tomatoes · 200 m² · Loam soil</span>
        </div>

        <div className={`experience-phone is-${state.phase.toLowerCase()}`} aria-label="AgroFlow farmer app">
          <div className="experience-phone-speaker" />
          <div className="experience-phone-screen">
            <div className="experience-phone-app"><i />AgroFlow</div>
            {recommendationVisible && (
              <div className="experience-phone-content">
                <small>North Field</small><b>Water today</b><span>8 mm · 1,600 L</span>
                <em>Irrigate</em>
              </div>
            )}
            {state.phase === "IRRIGATION_STARTING" && (
              <div className="experience-phone-content is-confirming">
                <i>✓</i><b>{state.controllerStatus === "ACTIVE" ? "Controller ready" : "Command sent"}</b>
                <span>{state.controllerStatus === "ACTIVE" ? "Starting pump…" : "Contacting North Field…"}</span>
              </div>
            )}
            {state.phase === "IRRIGATING" && (
              <div className="experience-phone-content is-running">
                <small>North Field</small><b>Irrigation running</b><span>{state.waterAppliedLitres.toLocaleString("en-US")} / {state.selectedWaterLitres.toLocaleString("en-US")} L</span>
                <div><i style={{ width: `${progress * 100}%` }} /></div>
              </div>
            )}
            {state.phase === "IRRIGATION_COMPLETE" && (
              <div className="experience-phone-content is-confirming"><i>✓</i><b>Target reached</b><span>{state.waterAppliedLitres.toLocaleString("en-US")} L applied</span></div>
            )}
            {(state.phase === "PLAN_RECALCULATING" || state.phase === "RESULT") && (
              <div className="experience-phone-content is-weather"><small>Forecast update</small><b>Plan updated</b><span>Next irrigation delayed</span></div>
            )}
          </div>
          {state.phase === "IRRIGATION_STARTING" && <div className="experience-phone-signal" aria-hidden="true"><i /></div>}
        </div>

        <div className="experience-overlay" id="experienceCard">
          {recommendationVisible && <RecommendationCard state={state} dispatch={dispatch} />}

          {irrigationVisible && (
            <section className="experience-status" role="status" aria-live="polite">
              <div><i className="experience-pulse" /><strong>Irrigating North Field</strong></div>
              <span>{state.waterAppliedLitres.toLocaleString("en-US")} / {state.selectedWaterLitres.toLocaleString("en-US")} L</span>
              <div className="experience-progress"><i style={{ width: `${progress * 100}%` }} /></div>
              <small>Controller online · Pump {state.pumpRunning ? "running" : "starting"}</small>
            </section>
          )}

          {state.phase === "IRRIGATION_COMPLETE" && (
            <section className="experience-card experience-complete" role="status">
              <span className="experience-kicker">Irrigation complete</span>
              <h2>{state.waterAppliedLitres.toLocaleString("en-US")} L applied</h2>
              <p>{state.selectedWaterLitres < scenario.recommendedLitres
                ? "The farmer-selected amount was below AgroFlow's recommendation. Monitoring will continue."
                : "The field no longer requires irrigation today."}</p>
              <div className="experience-next-check"><span>Next check</span><strong>Tomorrow</strong></div>
              <button type="button" className="experience-primary" onClick={() => dispatch({ type: "WEATHER_CHANGED" })}>Continue</button>
            </section>
          )}

          {state.phase === "PLAN_RECALCULATING" && (
            <section className="experience-card experience-weather" role="alert">
              <span className="experience-kicker">Heavy rain expected</span>
              <h2>18 mm expected tomorrow.</h2>
              <p>AgroFlow has updated the plan.</p>
              <div className="experience-plan-change">
                <div><span>Before</span><strong>Next irrigation · Sunday</strong></div>
                <i aria-hidden="true">→</i>
                <div><span>Now</span><strong>Next irrigation · Tuesday</strong></div>
              </div>
            </section>
          )}

          {state.phase === "RESULT" && (
            <section className="experience-card experience-final" role="status">
              <span className="experience-kicker">That's AgroFlow</span>
              <h2>One clear decision, continuously updated.</h2>
              <p>Field data. Weather. Crop science. Farmer control.</p>
              {state.waterAppliedLitres > 0 && (
                <div className="experience-mini-timeline" aria-label="Updated irrigation plan">
                  <div><strong>Today</strong><span>Irrigation complete ✓</span></div>
                  <div><strong>Tomorrow</strong><span>Rain expected</span></div>
                  <div><strong>Next</strong><span>No irrigation expected</span></div>
                </div>
              )}
              {state.resultMessage && <small>{state.resultMessage}</small>}
              <div className="experience-final-actions">
                <button type="button" className="experience-primary" onClick={exploreTechnology}>Explore the technology</button>
                <button type="button" className="experience-secondary" onClick={() => dispatch({ type: "RESET" })}>Restart demo</button>
                <button type="button" className="experience-text-button" onClick={onClose}>Return to site</button>
              </div>
            </section>
          )}
        </div>

        {state.whyOpen && (
          <div className="experience-sheet-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) dispatch({ type: "TOGGLE_WHY" });
          }}>
            <aside className="experience-why-sheet" aria-label="Why AgroFlow recommends irrigation">
              <button type="button" className="experience-sheet-close" onClick={() => dispatch({ type: "TOGGLE_WHY" })} aria-label="Close explanation">×</button>
              <span className="experience-kicker">Why water today?</span>
              <h2>The field has passed its irrigation threshold.</h2>
              <dl>
                <div><dt>Weather demand</dt><dd>{scenario.etoMm} mm/day</dd></div>
                <div><dt>Crop coefficient</dt><dd>{scenario.kc.toFixed(2)}</dd></div>
                <div><dt>Crop water demand</dt><dd>{scenario.etcMm} mm/day</dd></div>
                <div><dt>Root-zone depletion</dt><dd>{scenario.depletionMm} mm</dd></div>
                <div><dt>Irrigation threshold</dt><dd>{scenario.rawMm} mm</dd></div>
                <div><dt>Expected rain</dt><dd>{scenario.forecastRainMm} mm</dd></div>
              </dl>
              <p>The field has passed its irrigation threshold and expected rain is not enough to cover the deficit.</p>
              <small>FAO-56-informed, rules-based decision support. The farmer makes the final decision.</small>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
