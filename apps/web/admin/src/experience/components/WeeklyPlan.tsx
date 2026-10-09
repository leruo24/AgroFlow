import type { PlanDay } from "../engine/weeklyProjection";

export function WeeklyPlan({ plan, recalculating }: { plan: PlanDay[]; recalculating: boolean }) {
  return (
    <section className="experience-plan" aria-labelledby="experiencePlanHeading" aria-busy={recalculating}>
      <div className="experience-panel-heading">
        <div>
          <span className="experience-kicker">Rolling outlook</span>
          <h2 id="experiencePlanHeading">Next 7 days</h2>
        </div>
        {recalculating && <span className="experience-recalculating">Recalculating…</span>}
      </div>
      <div className="experience-plan-days">
        {plan.map((day) => (
          <article className={`experience-plan-day is-${day.tone}`} key={day.day}>
            <strong>{day.day}</strong>
            <span>{day.action}</span>
          </article>
        ))}
      </div>
      <p className="experience-plan-note">The outlook carries forward as field and forecast conditions change.</p>
    </section>
  );
}

