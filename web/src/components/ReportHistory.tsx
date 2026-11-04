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
    <details className="panel history-panel">
      <summary>
        <span>Rapporthistorikk</span>
        <small>{history.length} siste</small>
      </summary>
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
    </details>
  );
}
