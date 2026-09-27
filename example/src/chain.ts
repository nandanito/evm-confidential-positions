/**
 * The base-ledger side: what any full-chain observer can read, plus the replay attempt.
 *
 * Reads go through `tools/observer/lib.ts` (the Task Zero harness logic, reused rather
 * than copied). This module adds only what the walkthrough needs on top of it: the Zeto
 * event decoded into named fields, `getRoot()`, and the double-spend replay.
 *
 * The replay (§1) is an HONEST double-spend attempt: it resubmits the calldata of a
 * transfer that already succeeded — the node's own valid proof, unmodified — from a fresh
 * EOA on our own local devnet. No proof is constructed or altered here.
 */
import { ethers } from "ethers";
import { abiJson, observeBaseLedgerTx, type Observation } from "../../tools/observer/lib.ts";

const EVENTS = ["UTXOTransfer", "UTXOMint", "UTXOTransferNonRepudiation"] as const;

export interface ZetoEvent {
  name: (typeof EVENTS)[number];
  inputs: string[]; // decimal strings; nullifiers on nullifier variants, commitments on Zeto_Anon
  outputs: string[]; // decimal strings; output commitments
  submitter: string;
  submitterTopic: string | null; // the indexed topic carrying the submitter
  fields: Record<string, unknown>; // every event field by ABI name (e.g. the non-repudiation ciphertexts)
}

export interface ObservedTx {
  label: string;
  hash: string;
  observation: Observation;
  event: ZetoEvent;
  calldata: string;
}

export class Chain {
  readonly provider: ethers.JsonRpcProvider;
  constructor(readonly rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  destroy(): void {
    this.provider.destroy();
  }

  async chainId(): Promise<bigint> {
    return (await this.provider.getNetwork()).chainId;
  }
  async clientVersion(): Promise<string> {
    return String(await this.provider.send("web3_clientVersion", []));
  }
  async blockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /** Observe a successful Zeto tx and pull out its transfer or mint event by name. */
  async observe(label: string, token: string, tokenAddress: string, hash: string): Promise<ObservedTx> {
    const observation = await observeBaseLedgerTx({ rpcUrl: this.rpcUrl, hash, tokenAddress, token });
    const ev = observation.logs.find((l) => l.decoded && (EVENTS as readonly string[]).includes(l.decoded.name));
    if (!ev?.decoded) throw new Error(`${label} (${hash}): no ${EVENTS.join("/")} event decoded`);
    const fields = eventFields(token, ev.decoded.name, ev.decoded.args);
    const inputs = ev.decoded.name === "UTXOMint" ? [] : (fields.inputs as string[]);
    return {
      label,
      hash,
      observation,
      calldata: String(observation.raw.tx.data),
      event: {
        name: ev.decoded.name as ZetoEvent["name"],
        inputs: inputs.map(String),
        outputs: (fields.outputs as string[]).map(String),
        submitter: String(fields.submitter),
        submitterTopic: ev.topics[1] ?? null,
        fields,
      },
    };
  }

  async getRoot(token: string, address: string): Promise<bigint> {
    const c = new ethers.Contract(address, abiJson(token), this.provider);
    return BigInt(await c.getRoot());
  }

  /**
   * Resubmit `hash`'s calldata to the same contract from a fresh EOA.
   * Returns the simulated revert (decoded against the variant's ABI) and the mined receipt.
   */
  async replay(token: string, hash: string): Promise<ReplayOutcome> {
    const orig = await this.provider.getTransaction(hash);
    if (!orig?.to) throw new Error(`replay: original tx ${hash} not found or has no 'to'`);
    const iface = new ethers.Interface(abiJson(token));
    const wallet = ethers.Wallet.createRandom().connect(this.provider);

    // 1. Simulate: the revert data names the check that fired.
    let simulated: ReplayOutcome["simulated"] = { reverted: false, error: null, args: [], raw: null };
    try {
      await this.provider.call({ from: wallet.address, to: orig.to, data: orig.data });
    } catch (e: any) {
      const raw: string | null = e?.data ?? e?.info?.error?.data ?? null;
      const parsed = raw ? iface.parseError(raw) : null;
      simulated = { reverted: true, error: parsed?.name ?? null, args: parsed ? parsed.args.map((a: any) => a.toString()) : [], raw };
    }

    // 2. Submit for real with an explicit gas limit (so no estimate short-circuits it) and
    //    read the mined receipt: a rejection on chain is status 0 with no logs.
    const sent = await wallet.sendTransaction({ to: orig.to, data: orig.data, gasLimit: orig.gasLimit, gasPrice: 0n });
    let receipt: ethers.TransactionReceipt | null = null;
    try {
      receipt = await sent.wait();
    } catch (e: any) {
      if (e?.code !== "CALL_EXCEPTION") throw e;
      receipt = await this.provider.getTransactionReceipt(sent.hash);
    }
    if (!receipt) throw new Error(`replay: no receipt for ${sent.hash}`);
    return {
      replayHash: sent.hash,
      replayFrom: wallet.address,
      originalFrom: orig.from,
      simulated,
      receiptStatus: receipt.status,
      receiptLogs: receipt.logs.length,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
  }
}

export interface ReplayOutcome {
  replayHash: string;
  replayFrom: string;
  originalFrom: string;
  simulated: { reverted: boolean; error: string | null; args: string[]; raw: string | null };
  receiptStatus: number | null;
  receiptLogs: number;
  gasUsed: string;
  blockNumber: number;
}

/** Map an event's positional args (as the observer lib returns them) to ABI field names. */
export function eventFields(token: string, eventName: string, args: any[]): Record<string, unknown> {
  const ev = abiJson(token).find((x: any) => x.type === "event" && x.name === eventName);
  if (!ev) throw new Error(`event ${eventName} not in ${token} ABI`);
  if (!Array.isArray(args) || args.length !== ev.inputs.length) {
    throw new Error(`event ${eventName}: expected ${ev.inputs.length} args, got ${Array.isArray(args) ? args.length : typeof args}`);
  }
  return Object.fromEntries(ev.inputs.map((inp: any, i: number) => [inp.name, args[i]]));
}
