/*
 * TASK-ZERO observer harness (Paladin + Zeto).
 *
 * Runs ONE real Zeto transfer on a local Paladin/Besu devnet, then records the
 * base-ledger transaction, receipt, block header fields and logs a full-chain
 * observer can read — raw AND decoded — and contrasts them with what the sending
 * node privately holds (its receipt states / domain receipt).
 *
 * Observation only: no proof forgery, no exploitation. The Zeto equivalent of
 * XLS-96 finding F-1.
 *
 * Module mode: ESM (package.json "type": "module"). The Paladin SDK ships as
 * CommonJS, so it is loaded through createRequire on purpose.
 *
 * Env (all optional):
 *   TOKEN        Zeto variant to deploy                (default Zeto_AnonNullifier)
 *   ABI          ABI basename in ./abi                  (default = TOKEN)
 *   BESU_RPC     base-ledger JSON-RPC                   (default http://localhost:31545)
 *   NODES_JSON   JSON array [{id,url},...] of 3 nodes   (default devnet localhost:31548/31648/31748)
 *   ISSUER, SENDER, RECEIVER   identity names           (default centralbank, bank1, bank2)
 *   ZETO_DOMAIN  Paladin domain name                    (default zeto)
 *   POLL_MS      receipt poll timeout                   (default 60000)
 *   OUT          JSON output path                       (default ./observer-out.json)
 */
import { createRequire } from "module";
import * as fs from "fs";
import { loadAbi, observeBaseLedgerTx, toJson } from "./lib.ts";

const require = createRequire(import.meta.url);
const sdk: any = require("@lfdecentralizedtrust/paladin-sdk");
const PaladinClient: any = sdk.default;
const ZetoFactory: any = sdk.ZetoFactory;
if (typeof PaladinClient !== "function" || typeof ZetoFactory !== "function") {
  throw new Error("paladin-sdk export shape changed: expected default PaladinClient and ZetoFactory constructors");
}

// Config is parsed inside main() so a bad value is reported cleanly, not as a load-time crash.
function loadConfig() {
  const TOKEN = process.env.TOKEN || "Zeto_AnonNullifier";
  return {
    TOKEN,
    ABI_FILE: process.env.ABI || TOKEN,
    BESU_RPC: process.env.BESU_RPC || "http://localhost:31545",
    OUT: process.env.OUT || "./observer-out.json",
    DOMAIN: process.env.ZETO_DOMAIN || "zeto",
    POLL: parsePositiveInt("POLL_MS", process.env.POLL_MS, 60000),
    ISSUER: process.env.ISSUER || "centralbank",
    SENDER: process.env.SENDER || "bank1",
    RECEIVER: process.env.RECEIVER || "bank2",
    NODES: parseNodes(process.env.NODES_JSON),
  };
}

function parsePositiveInt(name: string, raw: string | undefined, dflt: number): number {
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got '${raw}'`);
  return n;
}

function parseNodes(raw: string | undefined): { id: string; url: string }[] {
  const nodes = raw
    ? JSON.parse(raw)
    : [
        { id: "node1", url: "http://localhost:31548" },
        { id: "node2", url: "http://localhost:31648" },
        { id: "node3", url: "http://localhost:31748" },
      ];
  if (!Array.isArray(nodes) || nodes.length < 3 || !nodes.every((n) => typeof n?.id === "string" && typeof n?.url === "string")) {
    throw new Error("NODES_JSON must be an array of at least 3 {id, url} objects");
  }
  return nodes;
}

const log = (...a: any[]) => console.log(...a);

async function main(): Promise<void> {
  const { TOKEN, ABI_FILE, BESU_RPC, OUT, DOMAIN, POLL, ISSUER, SENDER, RECEIVER, NODES } = loadConfig();
  loadAbi(TOKEN, ABI_FILE); // validate TOKEN/ABI before spending time on a deploy
  const [p1, p2, p3] = NODES.map((n) => new PaladinClient({ url: n.url }));
  const [issuer] = p3.getVerifiers(`${ISSUER}@${NODES[2].id}`);
  const [sender] = p1.getVerifiers(`${SENDER}@${NODES[0].id}`);
  const [receiver] = p2.getVerifiers(`${RECEIVER}@${NODES[1].id}`);

  log(`# Observer harness — token=${TOKEN}  date=${new Date().toISOString()}`);
  log(`- Deploying ${TOKEN} ...`);
  const zeto = await new ZetoFactory(p3, DOMAIN).newZeto(issuer, { tokenName: TOKEN }).waitForDeploy(POLL);
  if (!zeto) throw new Error(`deploy of ${TOKEN} did not complete within ${POLL} ms`);
  log(`  token contract (base ledger): ${zeto.address}`);

  log(`- Minting 100000 to ${SENDER} ...`);
  const mintR = await zeto.mint(issuer, { mints: [{ to: sender, amount: 100000, data: "0x" }] }).waitForReceipt(POLL);
  if (!mintR?.success) throw new Error(`mint failed: ${JSON.stringify(toJson(mintR))}`);
  log(`  mint base-ledger tx: ${mintR.transactionHash}`);

  log(`- Transferring 1000 ${SENDER} -> ${RECEIVER} (the observed transfer) ...`);
  const xfer = await zeto.using(p1).transfer(sender, { transfers: [{ to: receiver, amount: 1000, data: "0x" }] }).waitForReceipt(POLL, true);
  if (!xfer?.success) throw new Error(`transfer failed: ${JSON.stringify(toJson(xfer))}`);
  const hash: string = xfer.transactionHash;
  log(`  transfer base-ledger tx: ${hash}`);

  // ---- what a FULL-CHAIN OBSERVER sees (base ledger only; logic in ./lib.ts) ----
  const observer = await observeBaseLedgerTx({ rpcUrl: BESU_RPC, hash, tokenAddress: zeto.address, token: TOKEN });

  {
    // ---- what the SENDING NODE privately holds (never on chain) ----
    const nodePrivate = {
      states: xfer.states !== undefined ? toJson(xfer.states) : { absent: true, reason: "receipt carried no states" },
      domainReceipt: xfer.domainReceipt !== undefined ? toJson(xfer.domainReceipt) : null,
      domainReceiptError: xfer.domainReceiptError ?? null,
    };

    const out = { token: TOKEN, tokenContract: zeto.address, date: new Date().toISOString(), besuRpc: BESU_RPC,
      transferBaseLedgerTx: hash, observer, nodePrivate };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

    log(`\n== FULL-CHAIN OBSERVER SEES (selected fields; raw tx/receipt/block in ${OUT}) ==`);
    log(JSON.stringify({ summary: observer.summary, method: observer.method, logs: observer.logs }, null, 2));
    log(`\n== SENDING NODE PRIVATELY HOLDS (not on chain) ==`);
    log(JSON.stringify(nodePrivate, null, 2));
    if (nodePrivate.domainReceiptError) log(`WARNING: domain receipt error: ${nodePrivate.domainReceiptError}`);
    log(`\nWritten to ${OUT}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
