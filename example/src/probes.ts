/**
 * The adversarial probes, as pure functions over observed data so they can be unit-tested
 * without a devnet (example/tests/probes.test.ts). Each returns a verdict the walkthrough
 * asserts; none of them decides what to print.
 */
import type { Coin } from "./paladin.ts";
import type { ReplayOutcome } from "./chain.ts";

/** Values that are not zero padding. Decimal strings in, decimal strings out. */
export function nonzero(xs: string[]): string[] {
  return xs.filter((x) => BigInt(x) !== 0n);
}

/** Node state ids are 0x-hex commitments; on-chain values are decimal. Normalise to decimal. */
export function idToDec(id: string): string {
  return BigInt(id).toString();
}

// ---------------------------------------------------------------------------
// Arm (a): a second spend of an already-spent note
// ---------------------------------------------------------------------------

export interface ReplayVerdict {
  ok: boolean;
  reasons: string[];
}

/**
 * The replay is rejected for the RIGHT reason only if all hold:
 *  - the simulation reverts with UTXOAlreadySpent naming the original's real nullifier
 *    (v0.2.2 `validateTransactionProposal` checks nullifiers before outputs and root, so
 *    this is the first check that fails, not merely some check);
 *  - the mined replay has status 0 and emitted no logs;
 *  - the SMT root is unchanged across the attempt.
 */
export function replayVerdict(r: ReplayOutcome, spentNullifiers: string[], rootBefore: bigint, rootAfter: bigint): ReplayVerdict {
  const reasons: string[] = [];
  if (!r.simulated.reverted) reasons.push("simulation did not revert");
  if (r.simulated.error !== "UTXOAlreadySpent") reasons.push(`simulated revert was ${r.simulated.error ?? "undecoded"}, expected UTXOAlreadySpent`);
  else if (!spentNullifiers.includes(r.simulated.args[0])) reasons.push(`UTXOAlreadySpent named ${r.simulated.args[0]}, not one of the original's nullifiers`);
  if (r.receiptStatus !== 0) reasons.push(`mined replay status ${r.receiptStatus}, expected 0`);
  if (r.receiptLogs !== 0) reasons.push(`mined replay emitted ${r.receiptLogs} logs, expected 0`);
  if (rootBefore !== rootAfter) reasons.push("SMT root changed across the replay");
  if (r.replayFrom.toLowerCase() === r.originalFrom.toLowerCase()) reasons.push("replay was sent from the original submitter; it must be a different EOA");
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Arm (b): linkability by value equality
// ---------------------------------------------------------------------------

export interface TxShape {
  label: string;
  inputs: string[]; // on-chain inputs (nullifiers or commitments), decimal
  outputs: string[]; // on-chain output commitments, decimal
}

export interface Link {
  from: string; // label of the tx that created the value
  to: string; // label of the later tx that consumed it
  value: string;
}

/**
 * Every later input that equals an earlier output. This is the whole of what a
 * full-chain observer can link from these fields by equality. It is NOT a proof of
 * unlinkability against every observer: timing, submitter EOA, note count and gas remain
 * (see leakShape / §4), and the anonymity set is only the tree's contents.
 */
export function equalityLinks(txs: TxShape[]): Link[] {
  const links: Link[] = [];
  for (let j = 0; j < txs.length; j++) {
    for (const v of nonzero(txs[j].inputs)) {
      for (let i = 0; i < j; i++) {
        if (nonzero(txs[i].outputs).includes(v)) links.push({ from: txs[i].label, to: txs[j].label, value: v });
      }
    }
  }
  return links;
}

/**
 * Ground truth for the probe: which earlier on-chain outputs did `spender` really spend,
 * according to the spending node's own receipt? If this is empty the probe is vacuous
 * (nothing to link), and the walkthrough must fail rather than report "unlinkable".
 */
export function trueSpends(spent: Coin[], earlier: TxShape[]): Link[] {
  const out: Link[] = [];
  for (const c of spent) {
    const v = idToDec(c.id);
    const src = earlier.find((t) => nonzero(t.outputs).includes(v));
    if (src) out.push({ from: src.label, to: "(node receipt)", value: v });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arm (c): boundary leaks
// ---------------------------------------------------------------------------

export interface Shape {
  realInputs: number;
  paddedInputs: number;
  realOutputs: number;
  paddedOutputs: number;
}

/** What zero padding reveals: the exact number of real input and output notes. */
export function leakShape(t: TxShape): Shape {
  return {
    realInputs: nonzero(t.inputs).length,
    paddedInputs: t.inputs.length - nonzero(t.inputs).length,
    realOutputs: nonzero(t.outputs).length,
    paddedOutputs: t.outputs.length - nonzero(t.outputs).length,
  };
}

/** The indexed submitter topic is the 32-byte left-padded tx.from. */
export function submitterTopicMatches(topic: string | null, from: string): boolean {
  if (!topic) return false;
  return BigInt(topic) === BigInt(from);
}

/** Split 0x-hex into 32-byte words as bigints, skipping an optional 4-byte selector. */
export function words32(hex: string, selector = false): bigint[] {
  let h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (selector) h = h.slice(8);
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= h.length; i += 64) out.push(BigInt("0x" + h.slice(i, i + 64)));
  return out;
}

/**
 * Plaintext search: does any secret (an amount, an owner key) appear as a whole 32-byte
 * word in the given public data? A hit means the value is on chain in the clear. A miss
 * is evidence for "not encoded as a plain word"; it does not rule out a derived encoding.
 */
export function plaintextHits(publicWords: bigint[], secrets: { label: string; value: bigint }[]): string[] {
  const set = new Set(publicWords.map((w) => w.toString()));
  return secrets.filter((s) => set.has(s.value.toString())).map((s) => s.label);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Commitments still live after the run: every non-zero output minus every commitment a
 * node reports it spent. Uses node-private spend records because on a nullifier variant
 * an observer cannot tell which commitment a nullifier spends — that is the point.
 */
export function liveCommitments(txs: TxShape[], spentByNodes: Coin[]): string[] {
  const spent = new Set(spentByNodes.map((c) => idToDec(c.id)));
  const all = txs.flatMap((t) => nonzero(t.outputs));
  return [...new Set(all)].filter((v) => !spent.has(v));
}
