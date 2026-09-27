/**
 * Configuration for the inter-desk walkthrough. Every value can be overridden by env so
 * the run is reproducible against a different devnet; defaults are the Task Zero kind
 * devnet (docs/task-zero/TASK-ZERO-2026-09-26.md §1).
 */
export interface Config {
  besuRpc: string;
  nodes: { id: string; url: string }[];
  domain: string;
  pollMs: number;
  issuer: string; // identity name on nodes[2]
  deskA: string; // identity name on nodes[0]
  deskB: string; // identity name on nodes[1]
  outDir: string;
}

function positiveInt(name: string, raw: string | undefined, dflt: number): number {
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got '${raw}'`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodes = env.NODES_JSON
    ? JSON.parse(env.NODES_JSON)
    : [
        { id: "node1", url: "http://localhost:31548" },
        { id: "node2", url: "http://localhost:31648" },
        { id: "node3", url: "http://localhost:31748" },
      ];
  if (!Array.isArray(nodes) || nodes.length < 3 || !nodes.every((n: any) => typeof n?.id === "string" && typeof n?.url === "string")) {
    throw new Error("NODES_JSON must be an array of at least 3 {id, url} objects");
  }
  return {
    besuRpc: env.BESU_RPC || "http://localhost:31545",
    nodes,
    domain: env.ZETO_DOMAIN || "zeto",
    pollMs: positiveInt("POLL_MS", env.POLL_MS, 60000),
    issuer: env.ISSUER || "centraldesk",
    deskA: env.DESK_A || "deskA",
    deskB: env.DESK_B || "deskB",
    outDir: env.OUT_DIR || new URL("../out/", import.meta.url).pathname,
  };
}

/**
 * The scenario's amounts. T3 is larger than either note deskB received, so deskB's node
 * must spend both received notes together; that is what makes the linkability probe
 * non-vacuous (see probes.ts).
 */
export const SCENARIO = {
  mint: 100_000, // central desk -> deskA
  t1: 1_000, // deskA -> deskB
  t2: 700, // deskA -> deskB
  t3: 1_500, // deskB -> deskA, spends both of deskB's notes (1_700), change 200
} as const;
