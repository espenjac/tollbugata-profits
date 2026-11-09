import { describe, expect, it } from "vitest";
import { nordnetUrlForTicker } from "./nordnet";

describe("nordnetUrlForTicker", () => {
  it("uses the known Nordnet slug when available", () => {
    expect(nordnetUrlForTicker("AKER")).toBe(
      "https://www.nordnet.no/aksjer/kurser/aker-xosl",
    );
  });

  it("builds a safe Oslo URL for an older or unmapped simulator ticker", () => {
    expect(nordnetUrlForTicker("OLD-CO")).toBe(
      "https://www.nordnet.no/aksjer/kurser/old-co-xosl",
    );
    expect(nordnetUrlForTicker(" invalid ticker ")).toBeNull();
  });
});
