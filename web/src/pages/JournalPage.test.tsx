// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JournalState } from "../core/journal";
import { JournalPage } from "./JournalPage";

const journalState: JournalState = {
  startingCash: 5000,
  trades: [
    {
      id: "trade-1",
      executedAt: "2026-10-31T13:37:00+00:00",
      registeredAt: "2026-10-31T13:37:59+00:00",
      ticker: "EQNR",
      side: "buy",
      quantity: 49,
      price: 100,
      fee: 29,
      note: "testkjøp",
      editedAt: null,
    },
    {
      id: "trade-2",
      executedAt: "2026-10-31T13:43:00+00:00",
      registeredAt: "2026-10-31T13:43:48+00:00",
      ticker: "EQNR",
      side: "sell",
      quantity: 49,
      price: 109,
      fee: 29,
      note: "testsalg",
      editedAt: null,
    },
  ],
  adjustments: [],
  updatedAt: "2026-10-31T13:43:48+00:00",
};

vi.mock("../lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "00000000-0000-0000-0000-000000000001", email: "eier@example.com" },
    session: null,
    loading: false,
    configured: true,
    signInWithGoogle: async () => {},
    signOut: async () => {},
  }),
}));

vi.mock("../lib/api", () => ({
  loadJournal: async () => journalState,
  addTrade: async () => {},
  editTrade: async () => {},
  cashAdjustment: async () => {},
}));

describe("JournalPage", () => {
  it("renders balances, positions, trades and manual entry forms", async () => {
    const { container } = render(<JournalPage />);
    await waitFor(() => {
      expect(container.textContent).toContain("Handelsdagbok");
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Ledig kapital");
    expect(text).toContain("Loggfør handel");
    expect(text).toContain("Korriger ledig kapital");
    expect(text).toContain("Åpne posisjoner (0)");
    expect(text).toContain("EQNR");
    expect(text).toContain("testsalg");
    expect(text).toContain("5 383,00 kr");
  });
});
