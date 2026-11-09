import { describe, expect, it } from "vitest";
import { parseNordnetPriceHtml } from "../../../supabase/functions/_shared/nordnetQuote";

describe("parseNordnetPriceHtml", () => {
  it("reads the escaped price snapshot embedded by Nordnet", () => {
    const html = String.raw`<script>{"cache":{\"priceInfo\":{\"timeStamp\":1793981700000,\"realtime\":false,\"last\":394.9,\"bid\":392.6,\"ask\":396,\"close\":405.4,\"tradeTimestamp\":1793979900000}}}</script>`;

    expect(parseNordnetPriceHtml(html)).toEqual({
      last: 394.9,
      bid: 392.6,
      ask: 396,
      close: 405.4,
      timestamp: "2026-11-06T15:45:00.000Z",
    });
  });

  it("falls back to the close price and ignores invalid pages", () => {
    const html = `<script>{"priceInfo":{"timeStamp":1793981700000,"last":0,"close":99.6}}</script>`;

    expect(parseNordnetPriceHtml(html)).toEqual({
      last: 99.6,
      bid: null,
      ask: null,
      close: 99.6,
      timestamp: "2026-11-06T16:15:00.000Z",
    });
    expect(parseNordnetPriceHtml("<html></html>")).toBeNull();
  });
});
