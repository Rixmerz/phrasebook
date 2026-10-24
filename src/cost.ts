// USD per million tokens (input, output). Cache writes bill at 1.25x input, reads at 0.1x.
export const PRICES: Record<string, [number, number]> = {
  "haiku-4-5": [1, 5], "haiku-5-5": [0.1, 0.5], "sonnet-5-5": [2, 10], "opus-5-5": [4, 20],
};
export const shortModel = (m: string) => m.replace("claude-", "").replace(/-\d{8}$/, "");

export type Usage = { input_tokens: number; output_tokens: number; cache_write_tokens?: number; cache_read_tokens?: number };
export function usd(model: string, u: Usage) {
  const [pin, pout] = PRICES[shortModel(model)] ?? [0, 0];
  return (u.input_tokens * pin + (u.cache_write_tokens ?? 0) * pin * 1.25 + (u.cache_read_tokens ?? 0) * pin * 0.1 +
    u.output_tokens * pout) / 1e6;
}

// Spend ledger shared by every bench process: one line per run.
export const LEDGER = new URL("../results/ledger.jsonl", import.meta.url).pathname;
export function ledgerTotal(): number {
  try {
    return Deno.readTextFileSync(LEDGER).split("\n").filter(Boolean).reduce((s, l) => s + JSON.parse(l).usd, 0);
  } catch {
    return 0;
  }
}
