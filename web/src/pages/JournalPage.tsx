import { useMemo, useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS } from "../core/config";
import { formatDateTime, formatMoney, formatNumber, formatPrice } from "../core/format";
import {
  summarizeJournal,
  tradeCashChange,
  tradeSideLabel,
  type Holding,
  type TradeEntry,
  type TradeInput,
} from "../core/journal";
import { useAuth } from "../lib/auth-context";
import { useJournal } from "../lib/useJournal";
import {
  ErrorPanel,
  InlineNotice,
  LoadingView,
  StatCard,
} from "../components/ui";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? localInputValue() : localInputValue(date);
}

interface TradeForm {
  ticker: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fee: string;
  note: string;
  executedAt: string;
}

function emptyTradeForm(side: "buy" | "sell" = "buy"): TradeForm {
  return {
    ticker: "",
    side,
    quantity: "1",
    price: "",
    fee: String(
      side === "buy"
        ? DEFAULT_SETTINGS.trade.buyFee
        : DEFAULT_SETTINGS.trade.sellFee,
    ),
    note: "",
    executedAt: localInputValue(),
  };
}

function formFromTrade(trade: TradeEntry): TradeForm {
  return {
    ticker: trade.ticker,
    side: trade.side,
    quantity: String(trade.quantity),
    price: String(trade.price),
    fee: String(trade.fee),
    note: trade.note,
    executedAt: toLocalInput(trade.executedAt),
  };
}

function inputNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function changeClass(value: number): string {
  if (value > 0) {
    return "positive";
  }
  if (value < 0) {
    return "negative";
  }
  return "";
}

export function JournalPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const {
    journal,
    loading,
    error,
    status,
    add,
    edit,
    setCash,
    reload,
  } = useJournal(userId);

  const [form, setForm] = useState<TradeForm>(() => emptyTradeForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cashForm, setCashForm] = useState({ amount: "", note: "" });
  const [cashError, setCashError] = useState<string | null>(null);
  const [cashSaving, setCashSaving] = useState(false);

  const summary = useMemo(
    () => (journal ? summarizeJournal(journal) : null),
    [journal],
  );
  const trades = useMemo(
    () =>
      journal
        ? journal.trades
            .slice()
            .sort((a, b) => {
              const compared = b.executedAt.localeCompare(a.executedAt);
              if (compared !== 0) {
                return compared;
              }
              const registered = b.registeredAt.localeCompare(a.registeredAt);
              return registered !== 0 ? registered : b.id.localeCompare(a.id);
            })
        : [],
    [journal],
  );
  const adjustments = useMemo(
    () =>
      journal
        ? journal.adjustments
            .slice()
            .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
        : [],
    [journal],
  );

  if (loading && !journal) {
    return <LoadingView message="Laster handelsdagboken …" />;
  }
  if (error && !journal) {
    return (
      <ErrorPanel
        title="Kunne ikke laste handelsdagboken"
        message={error}
        onRetry={() => void reload()}
      />
    );
  }
  if (!journal || !summary) {
    return (
      <ErrorPanel
        title="Handelsdagboken er tom"
        message="Ingen data ble returnert fra Supabase."
        onRetry={() => void reload()}
      />
    );
  }

  const submitTrade = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      if (!form.ticker.trim()) {
        throw new Error("Ticker mangler.");
      }
      if (!form.price.trim()) {
        throw new Error("Kurs mangler.");
      }
      if (!form.executedAt) {
        throw new Error("Tidspunkt for handelen mangler.");
      }
      const input: TradeInput = {
        ticker: form.ticker,
        side: form.side,
        quantity: inputNumber(form.quantity),
        price: inputNumber(form.price),
        fee: inputNumber(form.fee),
        note: form.note,
        executedAt: new Date(form.executedAt).toISOString(),
      };
      if (editId) {
        await edit(editId, input);
      } else {
        await add(input);
      }
      setForm(emptyTradeForm());
      setEditId(null);
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setSaving(false);
    }
  };

  const submitCash = async (event: FormEvent) => {
    event.preventDefault();
    setCashError(null);
    setCashSaving(true);
    try {
      if (!cashForm.amount.trim()) {
        throw new Error("Fyll inn ny ledig kapital.");
      }
      const amount = inputNumber(cashForm.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Ledig kapital må være et tall som ikke er negativt.");
      }
      await setCash(amount, cashForm.note);
      setCashForm({ amount: "", note: "" });
    } catch (submitError) {
      setCashError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setCashSaving(false);
    }
  };

  const startEdit = (trade: TradeEntry) => {
    setForm(formFromTrade(trade));
    setEditId(trade.id);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startSell = (holding: Holding) => {
    setForm({
      ...emptyTradeForm("sell"),
      ticker: holding.ticker,
      quantity: String(holding.quantity),
      price: holding.averageCost === null ? "" : String(holding.averageCost),
    });
    setEditId(null);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setForm(emptyTradeForm());
    setEditId(null);
    setFormError(null);
  };

  return (
    <div className="page journal-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Manuell registrering</p>
          <h1>Handelsdagbok</h1>
          <p>
            Loggfør handler du faktisk har utført. Ledig kapital beregnes fra
            startkapital, handler og saldojusteringer. Appen sender aldri
            ordrer.
          </p>
        </div>
        <div className="journal-balance">
          <span>Ledig kapital</span>
          <strong>{formatMoney(summary.availableCash, 2)}</strong>
          <small>
            start {formatMoney(journal.startingCash, 2)} ·{" "}
            {adjustments.length} justeringer
          </small>
        </div>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {status ? <InlineNotice kind="success">{status}</InlineNotice> : null}

      <section className="stats-grid" aria-label="Dagbokstatus">
        <StatCard label="Ledig kapital" value={formatMoney(summary.availableCash, 2)} />
        <StatCard
          label="Realisiert"
          value={formatMoney(summary.realizedProfit, 2, true)}
          tone={
            summary.realizedProfit > 0
              ? "positive"
              : summary.realizedProfit < 0
                ? "negative"
                : "neutral"
          }
          hint="netto etter kurtasje"
        />
        <StatCard label="Kurtasje" value={formatMoney(summary.totalFees, 2)} />
        <StatCard
          label="Omsetning"
          value={formatMoney(summary.totalTurnover, 0)}
          hint={`${summary.buyCount} kjøp · ${summary.sellCount} salg`}
        />
      </section>

      <div className="journal-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {editId ? "Rediger" : "Ny registrering"}
              </p>
              <h2>{editId ? "Oppdater handel" : "Loggfør handel"}</h2>
            </div>
            {editId ? (
              <button className="btn btn-small" type="button" onClick={cancelEdit}>
                Avbryt
              </button>
            ) : null}
          </div>
          <form className="form-grid" onSubmit={submitTrade}>
            <label className="field">
              <span>Ticker</span>
              <input
                type="text"
                value={form.ticker}
                placeholder="F.eks. OET"
                autoComplete="off"
                onChange={(event) =>
                  setForm({ ...form, ticker: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label className="field">
              <span>Side</span>
              <select
                value={form.side}
                onChange={(event) => {
                  const side = event.target.value as "buy" | "sell";
                  setForm({
                    ...form,
                    side,
                    fee: String(
                      side === "buy"
                        ? DEFAULT_SETTINGS.trade.buyFee
                        : DEFAULT_SETTINGS.trade.sellFee,
                    ),
                  });
                }}
              >
                <option value="buy">Kjøp</option>
                <option value="sell">Salg</option>
              </select>
            </label>
            <label className="field">
              <span>Antall</span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.quantity}
                onChange={(event) =>
                  setForm({ ...form, quantity: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Kurs</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(event) =>
                  setForm({ ...form, price: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Kurtasje</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.fee}
                onChange={(event) =>
                  setForm({ ...form, fee: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Utført</span>
              <input
                type="datetime-local"
                value={form.executedAt}
                onChange={(event) =>
                  setForm({ ...form, executedAt: event.target.value })
                }
              />
            </label>
            <label className="field field-wide">
              <span>Notat</span>
              <input
                type="text"
                maxLength={500}
                value={form.note}
                placeholder="Valgfritt"
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
              />
            </label>
            {formError ? (
              <div className="field-wide">
                <InlineNotice kind="error">{formError}</InlineNotice>
              </div>
            ) : null}
            <div className="form-actions field-wide">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving}
              >
                {saving
                  ? "Lagrer …"
                  : editId
                    ? "Lagre endring"
                    : "Loggfør handel"}
              </button>
              <small>
                Registreringen påvirker bare dagboken og ledig kapital i
                rapporten.
              </small>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Kontroll</p>
              <h2>Korriger ledig kapital</h2>
            </div>
          </div>
          <p className="muted">
            Bruk dette hvis bankens saldo avviker fra den beregnede saldoen.
            Differansen lagres som en justering.
          </p>
          <form className="form-grid" onSubmit={submitCash}>
            <label className="field">
              <span>Ny ledig kapital</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={cashForm.amount}
                placeholder={summary.availableCash.toFixed(2)}
                onChange={(event) =>
                  setCashForm({ ...cashForm, amount: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Notat</span>
              <input
                type="text"
                maxLength={500}
                value={cashForm.note}
                placeholder="F.eks. overført fra bank"
                onChange={(event) =>
                  setCashForm({ ...cashForm, note: event.target.value })
                }
              />
            </label>
            {cashError ? (
              <div className="field-wide">
                <InlineNotice kind="error">{cashError}</InlineNotice>
              </div>
            ) : null}
            <div className="form-actions field-wide">
              <button
                className="btn"
                type="submit"
                disabled={cashSaving}
              >
                {cashSaving ? "Lagrer …" : "Lagre saldo"}
              </button>
            </div>
          </form>
          <details className="journal-breakdown">
            <summary>Se hvordan saldoen er beregnet</summary>
            <dl>
              <div>
                <dt>Startkapital</dt>
                <dd>{formatMoney(journal.startingCash, 2)}</dd>
              </div>
              <div>
                <dt>Netto fra handler</dt>
                <dd>
                  {formatMoney(
                    journal.trades.reduce(
                      (sum, trade) => sum + tradeCashChange(trade),
                      0,
                    ),
                    2,
                    true,
                  )}
                </dd>
              </div>
              <div>
                <dt>Saldojusteringer</dt>
                <dd>
                  {formatMoney(
                    journal.adjustments.reduce(
                      (sum, adjustment) => sum + adjustment.amount,
                      0,
                    ),
                    2,
                    true,
                  )}
                </dd>
              </div>
            </dl>
          </details>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Beholdning</p>
            <h2>Åpne posisjoner ({summary.holdings.length})</h2>
          </div>
        </div>
        {summary.holdings.length === 0 ? (
          <p className="muted">Ingen åpne posisjoner i dagboken.</p>
        ) : (
          <div className="table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="num">Antall</th>
                  <th className="num">Snittkost</th>
                  <th className="num">Kostbasis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.holdings.map((holding) => (
                  <tr key={holding.ticker}>
                    <td>{holding.ticker}</td>
                    <td className="num">{formatNumber(holding.quantity)}</td>
                    <td className="num">
                      {holding.averageCost === null
                        ? "–"
                        : `${formatPrice(holding.averageCost)} kr`}
                    </td>
                    <td className="num">{formatMoney(holding.costBasis, 2)}</td>
                    <td className="num">
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={() => startSell(holding)}
                      >
                        Selg
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Historikk</p>
            <h2>Handler ({trades.length})</h2>
          </div>
        </div>
        {trades.length === 0 ? (
          <p className="muted">Ingen handler er loggført ennå.</p>
        ) : (
          <div className="table-wrap">
            <table className="stock-table journal-table">
              <thead>
                <tr>
                  <th>Utført</th>
                  <th>Side</th>
                  <th>Ticker</th>
                  <th className="num">Antall</th>
                  <th className="num">Kurs</th>
                  <th className="num">Kurtasje</th>
                  <th className="num">Kontantstrøm</th>
                  <th>Notat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => {
                  const change = tradeCashChange(trade);
                  return (
                    <tr key={trade.id}>
                      <td>{formatDateTime(new Date(trade.executedAt))}</td>
                      <td>
                        <span
                          className={`side-badge side-${trade.side}`}
                        >
                          {tradeSideLabel(trade)}
                        </span>
                      </td>
                      <td className="ticker">{trade.ticker}</td>
                      <td className="num">{formatNumber(trade.quantity)}</td>
                      <td className="num">{formatPrice(trade.price)}</td>
                      <td className="num">{formatMoney(trade.fee, 2)}</td>
                      <td className={`num ${changeClass(change)}`}>
                        {formatMoney(change, 2, true)}
                      </td>
                      <td className="note-cell">{trade.note || "–"}</td>
                      <td className="num">
                        <button
                          className="btn btn-small"
                          type="button"
                          onClick={() => startEdit(trade)}
                        >
                          Rediger
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adjustments.length > 0 ? (
        <details className="panel exclusions">
          <summary>Saldojusteringer ({adjustments.length})</summary>
          <div className="table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Tid</th>
                  <th className="num">Endring</th>
                  <th>Notat</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td>{formatDateTime(new Date(adjustment.changedAt))}</td>
                    <td className={`num ${changeClass(adjustment.amount)}`}>
                      {formatMoney(adjustment.amount, 2, true)}
                    </td>
                    <td>{adjustment.note || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="disclaimer">
        Dagboken er ikke fasit for bankens saldo. Alle tall er det du selv har
        registrert. Ingen ordrer er sendt eller endret.
      </p>
    </div>
  );
}
