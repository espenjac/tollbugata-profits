import type { TradeConfig } from "./config";
import type { TradePlan, TradeScenario } from "./types";

export function buildTradePlan(
  price: number,
  config: TradeConfig,
  scenarioPcts?: Iterable<number>,
): TradePlan {
  if (price <= 0) {
    return emptyPlan(config, price);
  }
  const buyPrice = price * (1 + Math.max(0, config.slippagePct));
  const budget = Math.max(0, config.capital - config.buyFee);
  const shares = Math.floor(budget / buyPrice);
  if (shares <= 0) {
    return emptyPlan(config, price);
  }

  const invested = shares * buyPrice;
  const totalCost = invested + config.buyFee;
  const cashLeft = config.capital - totalCost;
  const targetPrice = buyPrice * (1 + config.targetPct);
  const stopPrice = buyPrice * (1 - config.stopLossPct);
  const targetNet = netResult(shares, buyPrice, targetPrice, config);
  const stopNet = netResult(shares, buyPrice, stopPrice, config);
  const rewardRisk =
    stopNet < 0 && targetNet > 0 ? targetNet / Math.abs(stopNet) : null;
  const pcts = scenarioPcts !== undefined ? Array.from(scenarioPcts) : config.scenarioPcts;
  const scenarios = pcts.map((change) => scenario(shares, buyPrice, config, change));

  return {
    capital: config.capital,
    buyFee: config.buyFee,
    sellFee: config.sellFee,
    entryPrice: buyPrice,
    shares,
    invested,
    cashLeft,
    totalCost,
    targetPrice,
    targetNet,
    targetReturnPct: totalCost !== 0 ? (targetNet / totalCost) * 100 : 0,
    stopPrice,
    stopNet,
    stopReturnPct: totalCost !== 0 ? (stopNet / totalCost) * 100 : 0,
    rewardRisk,
    scenarios,
    feasible: true,
  };
}

function netResult(
  shares: number,
  buyPrice: number,
  sellPrice: number,
  config: TradeConfig,
): number {
  const adjustedSell = Math.max(0, sellPrice) * (1 - Math.max(0, config.slippagePct));
  return (
    shares * adjustedSell -
    config.sellFee -
    shares * buyPrice -
    config.buyFee
  );
}

function scenario(
  shares: number,
  buyPrice: number,
  config: TradeConfig,
  change: number,
): TradeScenario {
  const exitPrice = buyPrice * (1 + change);
  const grossProfit = shares * (exitPrice - buyPrice);
  const netProfit = netResult(shares, buyPrice, exitPrice, config);
  const totalCost = shares * buyPrice + config.buyFee;
  return {
    changePct: change,
    exitPrice,
    grossProfit,
    netProfit,
    netReturnPct: totalCost !== 0 ? (netProfit / totalCost) * 100 : 0,
  };
}

function emptyPlan(config: TradeConfig, price: number): TradePlan {
  return {
    capital: config.capital,
    buyFee: config.buyFee,
    sellFee: config.sellFee,
    entryPrice: price,
    shares: 0,
    invested: 0,
    cashLeft: config.capital,
    totalCost: 0,
    targetPrice: 0,
    targetNet: 0,
    targetReturnPct: 0,
    stopPrice: 0,
    stopNet: 0,
    stopReturnPct: 0,
    rewardRisk: null,
    scenarios: [],
    feasible: false,
  };
}

export function simulateNet(
  entry: number,
  exitPrice: number,
  config: TradeConfig,
): { shares: number; net: number; netReturnPct: number } {
  if (entry <= 0) {
    return { shares: 0, net: 0, netReturnPct: 0 };
  }
  const buyPrice = entry * (1 + Math.max(0, config.slippagePct));
  const shares = Math.floor((config.capital - config.buyFee) / buyPrice);
  if (shares <= 0) {
    return { shares: 0, net: 0, netReturnPct: 0 };
  }
  const net = netResult(shares, buyPrice, exitPrice, config);
  const totalCost = shares * buyPrice + config.buyFee;
  return {
    shares,
    net,
    netReturnPct: totalCost !== 0 ? (net / totalCost) * 100 : 0,
  };
}
