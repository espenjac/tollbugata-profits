import { DEFAULT_CRITERIA, type Criteria } from "../core/screen";

export function Filters({
  criteria,
  onChange,
}: {
  criteria: Criteria;
  onChange: (criteria: Criteria) => void;
}) {
  const update = (patch: Partial<Criteria>) => {
    onChange({ ...criteria, ...patch });
  };
  const percent = (value: number) => Math.round(value * 1000) / 10;

  return (
    <section className="panel filters-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Screen</p>
          <h2>Filtre</h2>
        </div>
        <button
          className="btn btn-ghost btn-small"
          type="button"
          onClick={() => onChange({ ...DEFAULT_CRITERIA })}
        >
          Nullstill
        </button>
      </div>
      <div className="filters">
        <label className="field">
          <span>Min. ukeavkastning (%)</span>
          <input
            type="number"
            step="0.1"
            value={percent(criteria.minWeekReturn)}
            onChange={(event) =>
              update({ minWeekReturn: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label className="field">
          <span>ATH-margin (%)</span>
          <input
            type="number"
            step="0.1"
            min={0}
            max={50}
            value={percent(criteria.athMargin)}
            onChange={(event) =>
              update({ athMargin: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={criteria.requireAboveSma5}
            onChange={(event) =>
              update({ requireAboveSma5: event.target.checked })
            }
          />
          Over SMA5
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={criteria.requireAboveSma20}
            onChange={(event) =>
              update({ requireAboveSma20: event.target.checked })
            }
          />
          Over SMA20
        </label>
        <label className="check" title="Vis aksjer som er på/ved all-time high.">
          <input
            type="checkbox"
            checked={criteria.includeAtHigh}
            onChange={(event) =>
              update({ includeAtHigh: event.target.checked })
            }
          />
          Vis ATH-aksjer
        </label>
        <label
          className="check"
          title="Euronext Growth kan normalt ikke holdes på ASK."
        >
          <input
            type="checkbox"
            checked={!criteria.excludeGrowth}
            onChange={(event) =>
              update({ excludeGrowth: !event.target.checked })
            }
          />
          Vis Euronext Growth
        </label>
      </div>
      <details className="advanced-filters">
        <summary>Avanserte filtre</summary>
        <div className="filters">
          <label className="field">
            <span>Min. markedsverdi (mill. kr)</span>
            <input
              type="number"
              min={0}
              step="50"
              value={Math.round(criteria.minMarketCap / 1_000_000)}
              onChange={(event) =>
                update({
                  minMarketCap: Number(event.target.value) * 1_000_000,
                })
              }
            />
          </label>
          <label className="field">
            <span>Min. snittomsetning (mill. kr/dag)</span>
            <input
              type="number"
              min={0}
              step="1"
              value={Math.round(criteria.minTurnover / 1_000_000)}
              onChange={(event) =>
                update({ minTurnover: Number(event.target.value) * 1_000_000 })
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={criteria.allowUnknownAth}
              onChange={(event) =>
                update({ allowUnknownAth: event.target.checked })
              }
            />
            Tillat ukjent ATH
          </label>
          <label className="field">
            <span>Instrumenttyper</span>
            <input
              type="text"
              value={criteria.includeTypes.join(", ")}
              onChange={(event) =>
                update({
                  includeTypes: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      </details>
    </section>
  );
}
