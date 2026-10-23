import { publicLanguage, text as t } from "@/pages/publicCopy";
export function SoilCutaway({ moisture }: { moisture: number }) {
  const labels =
    publicLanguage() === "af"
      ? ["Grondlae", "Wortelsone", "Grondsensor", "Grondvog"]
      : publicLanguage() === "tn"
        ? [
            "Dikarolo tsa mmu",
            "Lefelo la medi",
            "Sediriswa sa mmu",
            "Bongola jwa mmu",
          ]
        : ["Soil layers", "Root zone", "Soil sensor", "Soil moisture"];
  return (
    <div className="soil-cutaway">
      <p>
        {t("simulated")} · {labels[0]} · {labels[3]} {Math.round(moisture)}%
      </p>
      <svg viewBox="0 0 900 520" aria-hidden="true" focusable="false">
        <path d="M0 180Q220 140 450 185T900 160V520H0" fill="#a46c47" />
        <path d="M0 300Q220 270 450 310T900 290V520H0" fill="#704d39" />
        <path d="M0 410Q220 370 450 405T900 390V520H0" fill="#4c3b2f" />
        <g fill="none" stroke="#f7f5ed" strokeWidth="5">
          <path d="M300 180v150m0-90-55 40m55-8 65 50m-65-17-30 50m30-150 42 30" />
        </g>
        <path
          d="M300 180V90q-80-80-100-25 10 60 100 55 80-100 115-55-10 55-115 77"
          fill="#487954"
        />
        <rect x="580" y="130" width="18" height="150" rx="6" fill="#19362b" />
        <path
          d="M589 130v-50h100"
          fill="none"
          stroke="#143d2a"
          strokeWidth="6"
        />
      </svg>
      <div className="cutaway-labels">
        <span>{labels[1]}</span>
        <span>{labels[2]}</span>
      </div>
    </div>
  );
}
