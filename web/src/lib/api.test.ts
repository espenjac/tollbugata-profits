// @vitest-environment jsdom
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { edgeFunctionErrorMessage } from "./api";

function httpError(status: number, body: unknown): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("edgeFunctionErrorMessage", () => {
  it("explains that a non-owner account is blocked", async () => {
    const error = httpError(403, { error: "This account is not allowed" });

    await expect(edgeFunctionErrorMessage(error)).resolves.toBe(
      "Denne kontoen har ikke tilgang. Logg inn med eierkontoen.",
    );
  });

  it("uses the error body for other HTTP errors", async () => {
    const error = httpError(500, { error: "Noe gikk galt i funksjonen." });

    await expect(edgeFunctionErrorMessage(error)).resolves.toBe(
      "Noe gikk galt i funksjonen.",
    );
  });

  it("gives a Norwegian message when Supabase cannot be reached", async () => {
    await expect(
      edgeFunctionErrorMessage(new FunctionsFetchError({})),
    ).resolves.toContain("Kunne ikke kontakte Supabase");

    await expect(
      edgeFunctionErrorMessage(new FunctionsRelayError({})),
    ).resolves.toContain("fikk ikke kontakt med markedsfunksjonen");
  });
});
