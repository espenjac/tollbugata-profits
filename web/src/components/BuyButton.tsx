import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { journalPrefillPath } from "../core/journalPrefill";
import { fetchNordnetQuote } from "../lib/api";

/**
 * Fetches the latest Nordnet price and opens the journal with ticker, price and
 * the current time prefilled. No order is ever sent.
 */
export function BuyButton({
  ticker,
  slug,
}: {
  ticker: string;
  slug: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const quote = await fetchNordnetQuote(ticker, slug);
      navigate(
        journalPrefillPath({
          ticker: quote.ticker || ticker,
          price: quote.last,
          time: new Date().toISOString(),
        }),
      );
    } catch (clickError) {
      setError(
        clickError instanceof Error ? clickError.message : String(clickError),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="buy-action">
      <button
        className="btn btn-primary btn-small"
        type="button"
        aria-label={`Kjøp ${ticker}`}
        disabled={busy}
        onClick={() => void handleClick()}
      >
        {busy ? "Henter Nordnet-kurs …" : "Kjøp"}
      </button>
      <small>Henter siste Nordnet-kurs og åpner dagboken.</small>
      {error ? (
        <p className="buy-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
