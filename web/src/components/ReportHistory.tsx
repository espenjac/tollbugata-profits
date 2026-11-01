import { formatDate, formatDateTime, formatNumber } from "../core/format";
import type { ReportHistoryItem } from "../lib/api";

export function ReportHistory({
  history,
  today,
  onView,
}: {
  history: ReportHistoryItem[];
  today: string;
  onView: (reportId: string) => void;
}) {
  if (history.length === 0) {
    return null;
  }
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Arkiv</p>
          <h2>Rapporthistorikk</h2>
        </div>
        <span className="muted">{history.length} siste</span>
      </div>
      <div className="history-list">
        {history.map((item) => (
          <div className="history-row" key={item.id}>
            <div>
              <strong>{formatDate(item.date)}</strong>
              <span>
                {item.noTrade || !item.mainTicker
                  ? "Ingen anbefalt kandidat"
                  : `${item.mainTicker} · score ${formatNumber(item.mainScore, 0)}`}
              </span>
              <small>{formatDateTime(item.generatedAt)}</small>
            </div>
            <div className="history-actions">
              {item.date === today ? <span className="chip">I dag</span> : null}
              <button
                className="btn btn-small"
                type="button"
                onClick={() => onView(item.id)}
              >
                Vis
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
