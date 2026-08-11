/**
 * Server-side allowlist of Gemini Managed Agents this deployment may invoke.
 *
 * CP5.1 policy:
 * - The browser only ever sends a short, stable `catalogId`. It NEVER sends an
 *   arbitrary `agentName` (that would let a client choose a different hosted
 *   agent than the one this repo bundles in `agent/`).
 * - The server resolves the `catalogId` against this allowlist. Unknown IDs get
 *   a 400 before any Gemini network call.
 * - Only agents that provably exist in the current source tree are listed.
 *   `antigravity-preview-05-2026` is the ONLY entry for CP5.1. It is marked
 *   legacy/experimental and is NOT yet externally verified (no controlled live
 *   test has been run against BYOK).
 * - No HEMAT/SEIMBANG/PRO tiers, no pricing claims, and no compatibility
 *   claims are made here. No other entry may be activated before a controlled
 *   live test.
 */

export interface CatalogEntry {
  /** Short public id sent by the client. */
  id: string;
  /** Real agent resource id passed to the Gemini Interactions API. */
  agentName: string;
  /** Shipment state — only "legacy-experimental" is permitted today. */
  release: "legacy-experimental";
  /** Whether a controlled live test against BYOK has verified this entry. */
  externallyVerified: boolean;
  notes: string;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "antigravity",
    agentName: "antigravity-preview-05-2026",
    release: "legacy-experimental",
    externallyVerified: false,
    notes:
      "Single legacy/experimental agent bundled in agent/agent.yaml (base_agent). " +
      "Not yet externally verified under BYOK; do not enable other entries first.",
  },
];

export function listCatalog(): ReadonlyArray<CatalogEntry> {
  return CATALOG;
}

export function resolveCatalogId(catalogId: unknown): CatalogEntry | null {
  if (typeof catalogId !== "string") return null;
  const trimmed = catalogId.trim();
  if (!trimmed) return null;
  return CATALOG.find((entry) => entry.id === trimmed) ?? null;
}

/**
 * Validate that the agent's own config file (agent/agent.yaml) still points at
 * an agent present in the catalog. Used at startup to prevent the bundled
 * agent definition and the runtime payload from silently diverging.
 */
export function catalogContainsAgentName(agentName: string): boolean {
  return CATALOG.some((entry) => entry.agentName === agentName);
}
