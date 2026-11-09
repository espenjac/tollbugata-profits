// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NordnetQuote } from "../lib/api";
import { BuyButton } from "./BuyButton";

const fetchNordnetQuote = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  fetchNordnetQuote,
}));

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={["/etrade"]}>
      <BuyButton ticker="EQNR" slug="equinor-eqnr-xosl" />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

const quote: NordnetQuote = {
  ticker: "EQNR",
  slug: "equinor-eqnr-xosl",
  last: 394.9,
  bid: 392.6,
  ask: 396,
  close: 405.4,
  timestamp: "2026-11-06T15:45:00.000Z",
  fetchedAt: "2026-11-08T13:37:00.000Z",
  source: "nordnet",
};

describe("BuyButton", () => {
  beforeEach(() => {
    fetchNordnetQuote.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the journal with the Nordnet price prefilled", async () => {
    fetchNordnetQuote.mockResolvedValue(quote);
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Kjøp EQNR" }));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain(
        "/logg?ticker=EQNR&price=394.90",
      );
    });
    expect(fetchNordnetQuote).toHaveBeenCalledWith(
      "EQNR",
      "equinor-eqnr-xosl",
    );
  });

  it("shows the error instead of navigating when Nordnet fails", async () => {
    fetchNordnetQuote.mockRejectedValue(new Error("Nordnet svarte HTTP 503."));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Kjøp EQNR" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Nordnet svarte HTTP 503.",
    );
    expect(screen.getByTestId("location").textContent).toBe("/etrade");
  });
});
