export interface ScoringWeights {
  momentum: number;
  trend: number;
  relativeStrength: number;
  liquidity: number;
  volume: number;
  technicalUpside: number;
  volatility: number;
  news: number;
  breakout: number;
  consistency: number;
}

export interface RiskWeights {
  volatility: number;
  overextension: number;
  spike: number;
  liquidity: number;
  event: number;
  negativeNews: number;
  marketCap: number;
  price: number;
}

export interface ScoringConfig {
  minPrice: number;
  minMarketCap: number;
  minAverageTurnover: number;
  maxWeekReturn: number;
  maxRsi: number;
  targetAtrPct: number;
  breakoutDistance: number;
  overextendedWeek: number;
  overextendedRsi: number;
  smoothDayReturn: number;
  smoothDayShare: number;
  spikeDayReturn: number;
  spikeDayShare: number;
  strongSpikeDayReturn: number;
  spikeSma5Distance: number;
  riskPenalty: number;
  weights: ScoringWeights;
  riskWeights: RiskWeights;
}

export type TradeMode = "day" | "swing";

export interface TradeConfig {
  capital: number;
  buyFee: number;
  sellFee: number;
  /** Swing is the default: 2-5 trading days, ATR-adjusted stop and target. */
  mode: TradeMode;
  /** Fixed day-trade target. Swing targets are derived from the ATR stop. */
  targetPct: number;
  /** Fallback swing stop when ATR is unavailable, or the fixed day-trade stop. */
  stopLossPct: number;
  slippagePct: number;
  minRewardRisk: number;
  scenarioPcts: number[];
}

export interface ReportConfig {
  maxAlternatives: number;
  minTotalScore: number;
  minOpportunity: number;
  maxRisk: number;
  minTurnover: number;
  blockNegativeNews: boolean;
  blockEarningsWithinDays: number;
  blockExDateWithinDays: number;
}

export interface Settings {
  scoring: ScoringConfig;
  trade: TradeConfig;
  report: ReportConfig;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  minPrice: 5,
  minMarketCap: 300_000_000,
  minAverageTurnover: 5_000_000,
  maxWeekReturn: 0.25,
  maxRsi: 82,
  targetAtrPct: 0.025,
  breakoutDistance: 0.05,
  overextendedWeek: 0.15,
  overextendedRsi: 75,
  smoothDayReturn: 0.02,
  smoothDayShare: 0.4,
  spikeDayReturn: 0.04,
  spikeDayShare: 0.6,
  strongSpikeDayReturn: 0.07,
  spikeSma5Distance: 0.05,
  riskPenalty: 0.45,
  weights: {
    momentum: 0.16,
    trend: 0.14,
    relativeStrength: 0.09,
    liquidity: 0.15,
    volume: 0.09,
    technicalUpside: 0.08,
    volatility: 0.05,
    news: 0.11,
    breakout: 0.05,
    consistency: 0.08,
  },
  riskWeights: {
    volatility: 0.18,
    overextension: 0.18,
    spike: 0.12,
    liquidity: 0.14,
    event: 0.14,
    negativeNews: 0.14,
    marketCap: 0.05,
    price: 0.05,
  },
};

export const DEFAULT_TRADE_CONFIG: TradeConfig = {
  capital: 5_000,
  buyFee: 29,
  sellFee: 29,
  mode: "swing",
  targetPct: 0.1,
  stopLossPct: 0.05,
  slippagePct: 0,
  minRewardRisk: 1,
  scenarioPcts: [-0.06, -0.03, 0, 0.03, 0.05, 0.08, 0.1, 0.13],
};

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  maxAlternatives: 10,
  minTotalScore: 58,
  minOpportunity: 55,
  maxRisk: 58,
  minTurnover: 10_000_000,
  blockNegativeNews: true,
  blockEarningsWithinDays: 1,
  blockExDateWithinDays: 0,
};

export const DEFAULT_SETTINGS: Settings = {
  scoring: DEFAULT_SCORING_CONFIG,
  trade: DEFAULT_TRADE_CONFIG,
  report: DEFAULT_REPORT_CONFIG,
};

export function mergeSettings(partial: {
  scoring?: Partial<ScoringConfig> & {
    weights?: Partial<ScoringWeights>;
    riskWeights?: Partial<RiskWeights>;
  };
  trade?: Partial<TradeConfig>;
  report?: Partial<ReportConfig>;
}): Settings {
  return {
    scoring: {
      ...DEFAULT_SETTINGS.scoring,
      ...partial.scoring,
      weights: {
        ...DEFAULT_SETTINGS.scoring.weights,
        ...partial.scoring?.weights,
      },
      riskWeights: {
        ...DEFAULT_SETTINGS.scoring.riskWeights,
        ...partial.scoring?.riskWeights,
      },
    },
    trade: {
      ...DEFAULT_SETTINGS.trade,
      ...partial.trade,
    },
    report: {
      ...DEFAULT_SETTINGS.report,
      ...partial.report,
    },
  };
}

export function settingsForCapital(settings: Settings, capital: number): Settings {
  return {
    ...settings,
    trade: {
      ...settings.trade,
      capital: capital,
    },
  };
}

export function weightTotal(weights: Record<string, number>): number {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}
