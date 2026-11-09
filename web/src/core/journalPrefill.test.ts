import { describe, expect, it } from "vitest";
import { journalPrefillPath, parseJournalPrefill } from "./journalPrefill";

describe("journal prefill", () => {
  it("builds a journal URL with ticker, price and time", () => {
    expect(
      journalPrefillPath({
        ticker: "eqnr",
        price: 394.9,
        time: "2026-11-08T13:37:00.000Z",
      }),
    ).toBe(
      "/logg?ticker=EQNR&price=394.90&time=2026-11-08T13%3A37%3A00.000Z",
    );
  });

  it("parses valid values and ignores incomplete input", () => {
    expect(
      parseJournalPrefill(
        new URLSearchParams(
          "ticker=eqnr&price=394,90&time=2026-11-08T13:37:00.000Z",
        ),
      ),
    ).toEqual({
      ticker: "EQNR",
      price: 394.9,
      time: "2026-11-08T13:37:00.000Z",
    });

    expect(
      parseJournalPrefill(new URLSearchParams("ticker=EQNR&price=0")),
    ).toBeNull();
    expect(
      parseJournalPrefill(
        new URLSearchParams("ticker=EQNR&price=10&time=ikke-en-dato"),
      ),
    ).toBeNull();
  });
});
