import { useEffect, useMemo, useState } from "react";
import {
  formatDateTime,
  formatNumber,
  formatPct,
  formatPrice,
} from "../core/format";
import {
  buildOpeningPlan,
  marketPhase,
  openingTimingText,
  OPENING_STATUS_LABELS,
  type OpeningPlan,
  type OpeningPhase,
  type OpeningStatus,
} from "../core/opening";
import type { PlannedCandidate, PremarketReport } from "../core/types";
import type { MarketSnapshot } from "../lib/api";
import { InlineNotice } from "./ui";

function statusTone(status: OpeningStatus): "positive" | "negative" | "neutral" {
  if (status === "klar" || status === "target") {
    return "positive";
  }
  if (status === "stoppet" || status === "ugyldig") {
    return "negative";
  }
  return "neutral";
}

function timingTone(phase: OpeningPhase): "success" | "warning" | "info" {
  if (phase === "open") {
    return "success";
  }
  if (phase === "closed") {
    return "info";
  }
  return "warning";
}

function rewardRiskText(value: number | null): string {
  return value === null ? "–" : formatNumber(value, 2);
}

function planCell(plan: OpeningPlan) {
  if (!plan.newPlan) {
    return (
      <>
        <strong>–</strong>
        <small>utilgjengelig</small>
      </>
    );
  }
  return (
    <>
      <strong>
        {formatPrice(plan.newPlan.targetPrice)} /{" "}
        {formatPrice(plan.newPlan.stopPrice)}
      </strong>
      <small>
        {plan.newPlan.shares} aksjer · R:R{" "}
        {rewardRiskText(plan.currentRewardRisk)}
      </small>
    </>
  );
}

export function OpeningPlanView({
  report,
  snapshot,
  refreshing,
  error,
  onRefresh,
}: {
  report: PremarketReport;
  snapshot: MarketSnapshot | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = marketPhase(now);
  const stale =
    snapshot !== null &&
    (phase === "open" || phase === "opening") &&
    now.getTime() - snapshot.universe.fetchedAt.getTime() > 10 * 60_000;
  const quotes = useMemo(
    () =>
      new Map(
        (snapshot?.universe.stocks ?? []).map((stock) => [stock.ticker, stock]),
      ),
    [snapshot],
  );
  const candidates = useMemo(() => {
    const planned: PlannedCandidate[] = [];
    if (report.main) {
      planned.push(report.main);
    }
    planned.push(...report.alternatives);
    return planned;
  }, [report]);
  const plans = useMemo(
    () =>
      candidates.map((planned) =>
        buildOpeningPlan(
          planned,
          quotes.get(planned.candidate.stock.ticker) ?? null,
          report.settings.trade,
          now,
        ),
      ),
    [candidates, quotes, report.settings.trade, now],
  );

  if (!report.main) {
    return null;
  }

  return (
    <section className="panel opening-plan" aria-label="Åpningsplan">
      <div className="opening-head">
        <div>
          <p className="eyebrow">Etter åpning · manuell bekreftelse</p>
          <h2>Åpningsplan</h2>
          <p>
            Rapporten bruker gårsdagens sluttkurs. Her regnes gevinstmål og
            tapsgrense på nytt fra faktisk åpningskurs, slik at et gap ikke
            gjør den gamle planen misvisende.
          </p>
        </div>
        <div className="opening-actions">
          <button
            className="btn btn-primary btn-small"
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? "Henter …" : "Hent åpningskurser"}
          </button>
          <small>
            {snapshot
              ? `Kurser ${formatDateTime(snapshot.universe.fetchedAt)}`
              : "Ingen åpningskurser hentet"}
          </small>
        </div>
      </div>

      <div className={`opening-timing timing-${timingTone(phase)}`}>
        {openingTimingText(phase)}
      </div>

      {stale && snapshot ? (
        <InlineNotice kind="warning">
          Åpningsplanen bruker kurser fra{" "}
          {formatDateTime(snapshot.universe.fetchedAt)}. Trykk «Hent
          åpningskurser» for ferske åpningskurser og VWAP.
        </InlineNotice>
      ) : null}
      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}

      <div className="table-wrap stack-wrap">
        <table className="mini-table stack-table opening-table">
          <thead>
            <tr>
              <th>Aksje</th>
              <th>Rapport-entry</th>
              <th>Åpning</th>
              <th>Gap</th>
              <th>Nå / VWAP</th>
              <th>Gammel plan</th>
              <th>Ny plan fra åpning</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.ticker}>
                <td data-label="Aksje">
                  <strong>{plan.ticker}</strong>
                  <small>{plan.name}</small>
                </td>
                <td data-label="Rapport-entry">
                  {formatPrice(plan.referenceEntry)} kr
                </td>
                <td data-label="Åpning">
                  {formatPrice(plan.openingPrice)} kr
                </td>
                <td data-label="Gap">
                  <span
                    className={`opening-gap ${
                      plan.gapPct === null
                        ? ""
                        : plan.gapPct >= 0
                          ? "gap-up"
                          : "gap-down"
                    }`}
                  >
                    {formatPct(plan.gapPct)}
                  </span>
                </td>
                <td data-label="Nå / VWAP">
                  <strong>{formatPrice(plan.currentPrice)} kr</strong>
                  <small>
                    VWAP {formatPrice(plan.vwap)} (
                    {formatPct(plan.vsVwapPct)})
                  </small>
                </td>
                <td data-label="Gammel plan">
                  <strong>
                    {formatPrice(plan.oldTarget)} / {formatPrice(plan.oldStop)}
                  </strong>
                  <small>
                    R:R ved åpning {rewardRiskText(plan.oldRewardRiskAtOpen)}
                  </small>
                </td>
                <td data-label="Ny plan fra åpning">{planCell(plan)}</td>
                <td data-label="Status">
                  <span
                    className={`opening-status tone-${statusTone(plan.status)}`}
                  >
                    {OPENING_STATUS_LABELS[plan.status]}
                  </span>
                  <small>{plan.statusText}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plans.some((plan) => plan.reasons.length > 0) ? (
        <div className="opening-reasons">
          {plans.map((plan) =>
            plan.reasons.length > 0 ? (
              <p key={plan.ticker}>
                <strong>{plan.ticker}:</strong> {plan.reasons.join(" ")}
              </p>
            ) : null,
          )}
        </div>
      ) : null}

      <p className="table-footnote">
        Gammel plan = rapportens target/stop. Ny plan = samme prosentsatser
        regnet fra åpningskursen. R:R er etter kurtasje. VWAP er dagens
        volumvektede snittkurs fra TradingView.
      </p>
    </section>
  );
}
