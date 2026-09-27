/**
 * The Paladin side: deploy, mint, transfer and node-private reads.
 *
 * Paladin proves in the sender's node (CLAIMS E-8), so this module never touches a proving
 * key or a witness. It returns the base-ledger tx hash plus the node's receipt state lists.
 * On Paladin v1.0.0 the Zeto domain receipt is not implemented (CLAIMS F-6): the state
 * lists are the node-private record, and `domainReceiptError` is kept, not hidden.
 */
import { createRequire } from "node:module";
import type { Config } from "./config.ts";

const require = createRequire(import.meta.url);
const sdk: any = require("@lfdecentralizedtrust/paladin-sdk");
const PaladinClient: any = sdk.default;
const ZetoFactory: any = sdk.ZetoFactory;
// SDK 1.0.0's ZetoInstance.balanceOf hard-codes domain "zeto"; we issue the same call with
// the configured domain instead, so a ZETO_DOMAIN override reaches every node-private read.
const zetoPrivateAbi: any[] = require("@lfdecentralizedtrust/paladin-sdk/build/domains/abis/IZetoFungible.json").abi;
const TX_PRIVATE: string = sdk.TransactionType?.PRIVATE;
if (typeof TX_PRIVATE !== "string") throw new Error("paladin-sdk export shape changed: expected TransactionType.PRIVATE");
if (typeof PaladinClient !== "function" || typeof ZetoFactory !== "function") {
  throw new Error("paladin-sdk export shape changed: expected default PaladinClient and ZetoFactory constructors");
}

/** A coin state as the node holds it. `id` is the on-chain commitment, hex-encoded. */
export interface Coin {
  id: string;
  amount: bigint;
  owner: string; // compressed Baby Jubjub public key, node-private
}

export interface NodeReceipt {
  hash: string;
  /** Coins this tx created, as known to the submitting node. */
  created: Coin[];
  /** Coins this tx spent, as known to the submitting node. */
  spent: Coin[];
  domainReceiptError: string | null;
}

export interface Party {
  name: string; // identity name, e.g. "deskA"
  lookup: string; // "deskA@node1"
  client: any; // PaladinClient of the node that holds this party's keys
  verifier: any; // PaladinVerifier
}

export function connect(cfg: Config): { clients: any[]; party: (name: string, node: number) => Party } {
  const clients = cfg.nodes.map((n) => new PaladinClient({ url: n.url }));
  const party = (name: string, node: number): Party => {
    const lookup = `${name}@${cfg.nodes[node].id}`;
    const [verifier] = clients[node].getVerifiers(lookup);
    return { name, lookup, client: clients[node], verifier };
  };
  return { clients, party };
}

function coins(list: any[] | undefined): Coin[] {
  // Receipt state lists also carry SMT node states and info states; a coin has amount+owner.
  return (list ?? [])
    .filter((s) => s?.data && s.data.amount !== undefined && s.data.owner !== undefined)
    .map((s) => ({ id: String(s.id).toLowerCase(), amount: BigInt(s.data.amount), owner: String(s.data.owner) }));
}

function toReceipt(what: string, r: any): NodeReceipt {
  if (!r?.success) throw new Error(`${what} failed: ${JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  if (typeof r.transactionHash !== "string") throw new Error(`${what}: receipt has no base-ledger transactionHash`);
  if (!r.states) throw new Error(`${what}: receipt carried no state lists (waitForReceipt(…, true) should include them)`);
  return {
    hash: r.transactionHash,
    created: coins(r.states.confirmed),
    spent: coins(r.states.spent),
    domainReceiptError: r.domainReceiptError ?? null,
  };
}

export class Token {
  constructor(
    readonly variant: string,
    readonly address: string,
    private readonly instance: any,
    private readonly pollMs: number,
    private readonly domain: string,
  ) {}

  static async deploy(cfg: Config, variant: string, issuer: Party): Promise<Token> {
    const zeto = await new ZetoFactory(issuer.client, cfg.domain).newZeto(issuer.verifier, { tokenName: variant }).waitForDeploy(cfg.pollMs);
    if (!zeto) throw new Error(`deploy of ${variant} did not complete within ${cfg.pollMs} ms`);
    return new Token(variant, String(zeto.address).toLowerCase(), zeto, cfg.pollMs, cfg.domain);
  }

  async mint(issuer: Party, to: Party, amount: number): Promise<NodeReceipt> {
    const r = await this.instance
      .using(issuer.client)
      .mint(issuer.verifier, { mints: [{ to: to.verifier, amount, data: "0x" }] })
      .waitForReceipt(this.pollMs, true);
    return toReceipt(`${this.variant} mint ${amount} -> ${to.lookup}`, r);
  }

  async transfer(from: Party, to: Party, amount: number): Promise<NodeReceipt> {
    const r = await this.instance
      .using(from.client)
      .transfer(from.verifier, { transfers: [{ to: to.verifier, amount, data: "0x" }] })
      .waitForReceipt(this.pollMs, true);
    return toReceipt(`${this.variant} transfer ${amount} ${from.lookup} -> ${to.lookup}`, r);
  }

  /** Node-private: what the party's own node reports as its unspent balance. */
  async balanceOf(p: Party): Promise<{ total: bigint; states: number; overflow: boolean }> {
    const r = await p.client.call({
      type: TX_PRIVATE,
      domain: this.domain,
      abi: zetoPrivateAbi,
      function: "balanceOf",
      to: this.address,
      from: p.lookup,
      data: { account: p.lookup },
    });
    if (r?.totalBalance === undefined) throw new Error(`balanceOf(${p.lookup}) on ${this.address} returned no totalBalance: ${JSON.stringify(r)}`);
    return { total: BigInt(r.totalBalance), states: Number(r.totalStates), overflow: Boolean(r.overflow) };
  }
}
