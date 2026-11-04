import type { Settings, TradeConfig } from "./config";

const TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;

export type TradeSide = "buy" | "sell";

export interface TradeEntry {
  id: string;
  executedAt: string;
  registeredAt: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee: number;
  note: string;
  editedAt: string | null;
}

export interface CashAdjustment {
  id: string;
  changedAt: string;
  amount: number;
  note: string;
}

export interface JournalState {
  startingCash: number;
  trades: TradeEntry[];
  adjustments: CashAdjustment[];
  updatedAt: string;
}

export interface Holding {
  ticker: string;
  quantity: number;
  costBasis: number;
  averageCost: number | null;
}

export interface HoldingPlan {
  targetPrice: number;
  targetNet: number;
  stopPrice: number;
  stopNet: number;
}

/** Sell levels for an actual position, using the same percentages as the report. */
export function holdingPlan(
  holding: Holding,
  config: TradeConfig,
): HoldingPlan | null {
  const cost = holding.averageCost;
  if (cost === null || cost <= 0 || holding.quantity <= 0) {
    return null;
  }
  const targetPrice = cost * (1 + config.targetPct);
  const stopPrice = cost * (1 - config.stopLossPct);
  const slippage = Math.max(0, config.slippagePct);
  const targetNet = money(
    holding.quantity * targetPrice * (1 - slippage) -
      holding.costBasis -
      config.sellFee,
  );
  const stopNet = money(
    holding.quantity * stopPrice * (1 - slippage) -
      holding.costBasis -
      config.sellFee,
  );
  return { targetPrice, targetNet, stopPrice, stopNet };
}

export interface JournalSummary {
  availableCash: number;
  holdings: Holding[];
  realizedProfit: number;
  totalFees: number;
  totalTurnover: number;
  buyCount: number;
  sellCount: number;
}

export interface TradeInput {
  id?: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fee?: number;
  note?: string;
  executedAt?: string;
  registeredAt?: string;
}

export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalError";
  }
}

function money(value: number): number {
  return Math.round((Number(value) + 1e-9) * 100) / 100;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeJournalTicker(value: string): string {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!ticker) {
    throw new JournalError("Ticker mangler.");
  }
  if (!TICKER_RE.test(ticker)) {
    throw new JournalError(
      "Ticker kan bare inneholde bokstaver, tall, punktum, bindestrek og _.",
    );
  }
  return ticker;
}

function numberValue(value: unknown, name: string, minimum = 0): number {
  if (typeof value === "boolean") {
    throw new JournalError(`${name} må være et tall.`);
  }
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) {
    throw new JournalError(`${name} må være et tall.`);
  }
  if (number < minimum) {
    throw new JournalError(`${name} kan ikke være lavere enn ${minimum}.`);
  }
  return number;
}

function wholeShares(value: unknown): number {
  if (typeof value === "boolean") {
    throw new JournalError("Antall aksjer må være et heltall.");
  }
  const raw = String(value ?? "").trim().replace(",", ".");
  const number = Number(raw);
  if (!raw || !Number.isFinite(number) || !Number.isInteger(number)) {
    throw new JournalError("Antall aksjer må være et heltall.");
  }
  if (number <= 0) {
    throw new JournalError("Antall aksjer må være større enn 0.");
  }
  return number;
}

function cleanNote(value: unknown, maxLength = 500): string {
  const note = String(value ?? "").trim();
  if (note.length > maxLength) {
    throw new JournalError(`Notatet kan ikke være lengre enn ${maxLength} tegn.`);
  }
  return note;
}

function dateValue(value: string | undefined, name: string): string {
  if (value === undefined || value === null || value === "") {
    return nowIso();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new JournalError(`${name} har ugyldig dato/tid.`);
  }
  return date.toISOString();
}

function prepareTrade(input: TradeInput, registeredAt: string): TradeEntry {
  const ticker = normalizeJournalTicker(input.ticker);
  if (input.side !== "buy" && input.side !== "sell") {
    throw new JournalError("Handelens side må være buy eller sell.");
  }
  const quantity = wholeShares(input.quantity);
  const price = numberValue(input.price, "Kurs", 0.0001);
  const fee = numberValue(input.fee ?? 0, "Kurtasje");
  const note = cleanNote(input.note ?? "");
  const executedAt = dateValue(input.executedAt, "Handelsdato");
  if (input.side === "sell" && quantity * price - fee < 0) {
    throw new JournalError("Kurtasjen er større enn salgssummen.");
  }
  return {
    id: input.id ?? newId(),
    executedAt,
    registeredAt,
    ticker,
    side: input.side,
    quantity,
    price,
    fee,
    note,
    editedAt: null,
  };
}

export function tradeCashChange(trade: TradeEntry): number {
  const gross = money(trade.quantity * trade.price);
  return money(trade.side === "buy" ? -gross - trade.fee : gross - trade.fee);
}

export function tradeGross(trade: TradeEntry): number {
  return money(trade.quantity * trade.price);
}

export function tradeSideLabel(trade: TradeEntry): string {
  return trade.side === "buy" ? "Kjøp" : "Salg";
}

export function deriveCash(state: JournalState): number {
  const tradeTotal = state.trades.reduce(
    (sum, trade) => sum + tradeCashChange(trade),
    0,
  );
  const adjustmentTotal = state.adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    0,
  );
  return money(state.startingCash + tradeTotal + adjustmentTotal);
}

export function recordTrade(state: JournalState, input: TradeInput): JournalState {
  const registeredAt = dateValue(input.registeredAt, "Registrert");
  const trade = prepareTrade(input, registeredAt);
  const currentCash = deriveCash(state);
  const change = tradeCashChange(trade);
  if (trade.side === "buy" && change < -currentCash - 0.005) {
    const shortfall = Math.abs(change) - currentCash;
    throw new JournalError(
      `For lite ledig kapital. Kjøpet koster ${(tradeGross(trade) + trade.fee).toFixed(2)} kr, ` +
        `og du har ${currentCash.toFixed(2)} kr. Mangler ${shortfall.toFixed(2)} kr.`,
    );
  }
  return {
    ...state,
    trades: [...state.trades, trade],
    updatedAt: registeredAt,
  };
}

export function updateTrade(
  state: JournalState,
  tradeId: string,
  input: Omit<TradeInput, "id">,
): JournalState {
  const index = state.trades.findIndex((trade) => trade.id === tradeId);
  if (index === -1) {
    throw new JournalError(`Fant ikke handel ${tradeId}.`);
  }
  const oldTrade = state.trades[index];
  const updated = prepareTrade(
    {
      ...input,
      id: oldTrade.id,
      registeredAt: oldTrade.registeredAt,
    },
    oldTrade.registeredAt,
  );
  const difference = money(tradeCashChange(updated) - tradeCashChange(oldTrade));
  const currentCash = deriveCash(state);
  const newCash = money(currentCash + difference);
  if (newCash < -0.005) {
    throw new JournalError(
      "Endringen ville gitt negativ ledig kapital " +
        `(${newCash.toFixed(2)} kr). Korriger saldoen eller en senere handel først.`,
    );
  }
  updated.editedAt = nowIso();
  const trades = state.trades.slice();
  trades[index] = updated;
  return {
    ...state,
    trades,
    updatedAt: updated.editedAt,
  };
}

export function setAvailableCash(
  state: JournalState,
  amount: number,
  note = "",
  changedAt = nowIso(),
  id = newId(),
): JournalState {
  const newCash = money(numberValue(amount, "Ledig kapital"));
  const cleanedNote = cleanNote(note);
  const currentCash = deriveCash(state);
  return {
    ...state,
    adjustments: [
      ...state.adjustments,
      {
        id,
        changedAt: dateValue(changedAt, "Endret"),
        amount: money(newCash - currentCash),
        note: cleanedNote,
      },
    ],
    updatedAt: changedAt,
  };
}

export function summarizeJournal(state: JournalState): JournalSummary {
  const positions = new Map<string, [number, number]>();
  let realized = 0;
  let fees = 0;
  let turnover = 0;
  let buys = 0;
  let sells = 0;
  const sortedTrades = state.trades
    .slice()
    .sort((a, b) => {
      const compared = a.executedAt.localeCompare(b.executedAt);
      if (compared !== 0) {
        return compared;
      }
      const registered = a.registeredAt.localeCompare(b.registeredAt);
      return registered !== 0 ? registered : a.id.localeCompare(b.id);
    });

  for (const trade of sortedTrades) {
    fees += trade.fee;
    turnover += trade.quantity * trade.price;
    const position = positions.get(trade.ticker) ?? [0, 0];
    if (trade.side === "buy") {
      buys += 1;
      position[0] += trade.quantity;
      position[1] += trade.quantity * trade.price + trade.fee;
      if (position[0] <= 0) {
        position[1] = 0;
      }
    } else {
      sells += 1;
      const proceeds = trade.quantity * trade.price - trade.fee;
      if (position[0] > 0) {
        const average = position[1] / position[0];
        const costRemoved = Math.min(position[1], average * trade.quantity);
        realized += proceeds - costRemoved;
        position[0] -= trade.quantity;
        position[1] = Math.max(0, position[1] - costRemoved);
      } else {
        realized += proceeds;
        position[0] -= trade.quantity;
      }
      if (position[0] <= 0) {
        position[1] = 0;
      }
    }
    positions.set(trade.ticker, position);
  }

  const holdings: Holding[] = Array.from(positions.entries())
    .filter(([, position]) => Math.trunc(position[0]) !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ticker, position]) => ({
      ticker,
      quantity: Math.trunc(position[0]),
      costBasis: money(position[1]),
      averageCost:
        Math.trunc(position[0]) > 0
          ? money(position[1] / Math.trunc(position[0]))
          : null,
    }));

  return {
    availableCash: deriveCash(state),
    holdings,
    realizedProfit: money(realized),
    totalFees: money(fees),
    totalTurnover: money(turnover),
    buyCount: buys,
    sellCount: sells,
  };
}

export function withAvailableCash(settings: Settings, cash: number): Settings {
  return {
    ...settings,
    trade: {
      ...settings.trade,
      capital: money(cash),
    },
  };
}

export function emptyJournal(startingCash = 5_000): JournalState {
  return {
    startingCash: money(startingCash),
    trades: [],
    adjustments: [],
    updatedAt: nowIso(),
  };
}
