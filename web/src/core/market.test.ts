import { describe, expect, it } from "vitest";
import { parseScannerPayload, SCANNER_COLUMNS } from "./market";

describe("parseScannerPayload", () => {
  it("parses opening price, day range and VWAP", () => {
    const columns: readonly string[] = SCANNER_COLUMNS;
    const row: unknown[] = columns.map(() => null);
    const set = (column: string, value: unknown) => {
      row[columns.indexOf(column)] = value;
    };
    set("name", "TEST");
    set("description", "Test AS");
    set("close", 100);
    set("currency", "NOK");
    set("open", 101);
    set("high", 102);
    set("high[1]", 99.5);
    set("low", 99);
    set("VWAP", 100.5);
    set("low[20]", 90);
    set("low[63]", 95);
    set("low[126]", 80);
    set("low[1]", 98);

    const stocks = parseScannerPayload({
      data: [{ s: "OSL:TEST", d: row }],
    });

    expect(stocks).toHaveLength(1);
    expect(stocks[0]).toMatchObject({
      ticker: "TEST",
      close: 100,
      open: 101,
      high: 102,
      previousDayHigh: 99.5,
      low: 99,
      vwap: 100.5,
    });
    expect(stocks[0].recentLows).toHaveLength(126);
    expect(stocks[0].recentLows?.[0]).toBe(80);
    expect(stocks[0].recentLows?.[63]).toBe(95);
    expect(stocks[0].recentLows?.[125]).toBe(98);
  });
});
