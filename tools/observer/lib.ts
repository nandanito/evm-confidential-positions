/*
 * Observer library: what a full-chain observer reads for one base-ledger transaction.
 *
 * Shared by observe.ts (the Task Zero harness) and example/run.ts §6, so the example
 * reuses the harness logic instead of carrying a copy. It reads Besu directly and takes
 * only plain values (URL, hash, address, variant name) and returns plain JSON, so a caller
 * with its own copy of ethers can use it without mixing library instances.
 *
 * Observation only: no proof forgery, no exploitation.
 */
import { ethers } from "ethers";
import * as fs from "fs";

// Only variants whose ABI is shipped in ./abi and whose transfer the harness has been run against.
// The non-repudiation variant is not on the Paladin devnet; example/run-auditor.ts deploys it
// standalone (Zeto v0.2.2 release artifacts) and observes its transfers through this library.
export const SUPPORTED = new Set(["Zeto_Anon", "Zeto_AnonEnc", "Zeto_AnonNullifier", "Zeto_AnonEncNullifierNonRepudiation"]);

/** The variant's Zeto v0.2.2 ABI as plain JSON (for callers holding their own ethers copy). */
export function abiJson(TOKEN: string, ABI_FILE: string = TOKEN): any[] {
  if (!SUPPORTED.has(TOKEN)) throw new Error(`TOKEN '${TOKEN}' not supported; use one of ${[...SUPPORTED].join(", ")}`);
  if (ABI_FILE !== TOKEN) throw new Error(`ABI '${ABI_FILE}' does not match TOKEN '${TOKEN}'; they must name the same variant`);
  const path = new URL(`./abi/${ABI_FILE}.json`, import.meta.url);
  if (!fs.existsSync(path)) throw new Error(`ABI file not found: ${path.pathname}`);
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function loadAbi(TOKEN: string, ABI_FILE: string = TOKEN): ethers.Interface {
  return new ethers.Interface(abiJson(TOKEN, ABI_FILE));
}

// Recursively make ethers Results / bigints JSON-safe while preserving structure and types.
export function toJson(v: any): any {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === "object") {
    if (typeof v.toArray === "function") return v.toArray().map(toJson);
    // Class instances such as ethers' Signature keep fields non-enumerable; use their own toJSON.
    if (typeof v.toJSON === "function") return toJson(v.toJSON());
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  }
  return v;
}

export interface ObservedLog {
  address: string;
  topics: string[];
  data: string;
  index: number;
  decoded: { name: string; signature: string; args: any } | null;
}

export interface Observation {
  summary: {
    from_eoa: string;
    to: string | null;
    nonce: number;
    type: number;
    value_wei: string;
    gasLimit: string;
    gasUsed: string;
    effGasPrice: string | null;
    status: number | null;
    blockNumber: number;
    blockHash: string;
    txIndex: number;
    blockTime: number;
    calldata_bytes: number;
  };
  method: { name: string; signature: string; args: any };
  logs: ObservedLog[];
  raw: { tx: any; receipt: any; block: any };
}

/**
 * Read one successful token transaction from the base ledger, raw and decoded.
 * Fails loudly when the tx/receipt/block is missing, the receipt status is not 1,
 * `tx.to` is not the token, calldata does not decode, or no token log decodes.
 */
export async function observeBaseLedgerTx(opts: {
  rpcUrl: string;
  hash: string;
  tokenAddress: string;
  token: string;
}): Promise<Observation> {
  const { rpcUrl, hash, tokenAddress, token } = opts;
  const iface = loadAbi(token);
  // The try covers only the RPC reads and decoding, so its error label is accurate.
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    const tx = await provider.getTransaction(hash);
    if (!tx) throw new Error(`tx ${hash} not found at ${rpcUrl}`);
    const rc = await provider.getTransactionReceipt(hash);
    if (!rc) throw new Error(`receipt for ${hash} not found at ${rpcUrl}`);
    if (rc.status !== 1) throw new Error(`receipt for ${hash} has status ${rc.status}, expected 1`);
    if (tx.to?.toLowerCase() !== tokenAddress.toLowerCase()) {
      throw new Error(`tx.to ${tx.to} does not match deployed token ${tokenAddress}`);
    }
    const block = await provider.getBlock(rc.blockNumber);
    if (!block) throw new Error(`block ${rc.blockNumber} not found at ${rpcUrl}`);

    const call = iface.parseTransaction({ data: tx.data, value: tx.value });
    if (!call) throw new Error(`calldata of ${hash} does not match any function in ABI ${token}`);
    const method = { name: call.name, signature: call.signature, args: toJson(call.args) };

    const logs: ObservedLog[] = rc.logs.map((lg) => {
      const raw = { address: lg.address, topics: [...lg.topics], data: lg.data, index: lg.index };
      const p = lg.address.toLowerCase() === tokenAddress.toLowerCase() ? iface.parseLog({ topics: [...lg.topics], data: lg.data }) : null;
      return p ? { ...raw, decoded: { name: p.name, signature: p.signature, args: toJson(p.args) } } : { ...raw, decoded: null };
    });
    if (!logs.some((l) => l.decoded)) throw new Error(`no log of ${hash} decodes against ABI ${token}`);

    // Selected, normalized observer-visible fields plus the raw objects they came from.
    return {
      summary: {
        from_eoa: tx.from,
        to: tx.to,
        nonce: tx.nonce,
        type: tx.type,
        value_wei: tx.value.toString(),
        gasLimit: tx.gasLimit.toString(),
        gasUsed: rc.gasUsed.toString(),
        effGasPrice: rc.gasPrice?.toString() ?? null,
        status: rc.status,
        blockNumber: rc.blockNumber,
        blockHash: rc.blockHash,
        txIndex: rc.index,
        blockTime: block.timestamp,
        calldata_bytes: ethers.dataLength(tx.data),
      },
      method,
      logs,
      raw: { tx: toJson(tx.toJSON()), receipt: toJson(rc.toJSON()), block: toJson(block.toJSON()) },
    };
  } catch (e: any) {
    throw new Error(`base-ledger observation of ${hash} via ${rpcUrl} failed: ${e?.message || e}`, { cause: e });
  } finally {
    provider.destroy();
  }
}
