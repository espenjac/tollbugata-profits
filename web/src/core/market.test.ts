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
    set("low", 99);
    set("VWAP", 100.5);

    const stocks = parseScannerPayload({
      data: [{ s: "OSL:TEST", d: row }],
    });

    expect(stocks).toHaveLength(1);
    expect(stocks[0]).toMatchObject({
      ticker: "TEST",
      close: 100,
      open: 101,
      high: 102,
      low: 99,
      vwap: 100.5,
    });
  });
});
