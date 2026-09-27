/**
 * The probes must be able to FAIL. Each test feeds a fixture where the claim is false and
 * asserts the probe says so, alongside the fixture where it holds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  equalityLinks, leakShape, liveCommitments, nonzero, plaintextHits, replayVerdict, submitterTopicMatches,
  trueSpends, words32, type TxShape,
} from "../src/probes.ts";
import { Book } from "../src/book.ts";
import type { ReplayOutcome } from "../src/chain.ts";

const coin = (dec: string, amount = 1n) => ({ id: "0x" + BigInt(dec).toString(16), amount, owner: "0x01" });

test("nonzero drops padding only", () => {
  assert.deepEqual(nonzero(["5", "0", "7", "0"]), ["5", "7"]);
});

test("equalityLinks finds a commitment re-used as an input (Zeto_Anon shape)", () => {
  const txs: TxShape[] = [
    { label: "T1", inputs: ["11", "0"], outputs: ["21", "22"] },
    { label: "T2", inputs: ["22", "0"], outputs: ["31", "32"] },
    { label: "T3", inputs: ["21", "31"], outputs: ["41", "42"] },
  ];
  const links = equalityLinks(txs).map((l) => `${l.from}->${l.to}:${l.value}`);
  assert.deepEqual(links, ["T1->T2:22", "T1->T3:21", "T2->T3:31"]);
});

test("equalityLinks finds nothing when inputs are nullifiers (Zeto_AnonNullifier shape)", () => {
  const txs: TxShape[] = [
    { label: "T1", inputs: ["901", "0"], outputs: ["21", "22"] },
    { label: "T3", inputs: ["902", "903"], outputs: ["41", "42"] },
  ];
  assert.equal(equalityLinks(txs).length, 0);
});

test("equalityLinks never links zero padding", () => {
  assert.equal(equalityLinks([{ label: "A", inputs: [], outputs: ["0", "5"] }, { label: "B", inputs: ["0"], outputs: [] }]).length, 0);
});

test("trueSpends: empty when the spender spent none of the earlier outputs (vacuous probe)", () => {
  const earlier: TxShape[] = [{ label: "T1", inputs: [], outputs: ["21", "22"] }];
  assert.equal(trueSpends([coin("99")], earlier).length, 0);
  assert.deepEqual(trueSpends([coin("22")], earlier).map((l) => l.from), ["T1"]);
});

test("leakShape counts real and padded slots", () => {
  assert.deepEqual(leakShape({ label: "x", inputs: ["9", "0"], outputs: ["1", "2"] }), { realInputs: 1, paddedInputs: 1, realOutputs: 2, paddedOutputs: 0 });
});

test("submitterTopicMatches compares a padded topic with an address", () => {
  const from = "0xafc9AA2D1ab0AcE9EbEB839b6274E5040Bc29C8c";
  const topic = "0x000000000000000000000000afc9aa2d1ab0ace9ebeb839b6274e5040bc29c8c";
  assert.equal(submitterTopicMatches(topic, from), true);
  assert.equal(submitterTopicMatches(topic, "0x0000000000000000000000000000000000000001"), false);
  assert.equal(submitterTopicMatches(null, from), false);
});

test("words32 + plaintextHits catch an amount written as a plain word, and skip the selector", () => {
  const word = (n: bigint) => n.toString(16).padStart(64, "0");
  const calldata = "0xdeadbeef" + word(2n) + word(1000n);
  const words = words32(calldata, true);
  assert.deepEqual(words, [2n, 1000n]);
  assert.deepEqual(plaintextHits(words, [{ label: "amount 1000", value: 1000n }, { label: "amount 700", value: 700n }]), ["amount 1000"]);
});

function outcome(over: Partial<ReplayOutcome> = {}): ReplayOutcome {
  return {
    replayHash: "0xr", replayFrom: "0xBBBB", originalFrom: "0xAAAA",
    simulated: { reverted: true, error: "UTXOAlreadySpent", args: ["777"], raw: "0x" },
    receiptStatus: 0, receiptLogs: 0, gasUsed: "1", blockNumber: 1, ...over,
  };
}

test("replayVerdict passes only for the right rejection", () => {
  assert.equal(replayVerdict(outcome(), ["777"], 5n, 5n).ok, true);
});
test("replayVerdict fails if the replay succeeded on chain", () => {
  assert.equal(replayVerdict(outcome({ receiptStatus: 1, receiptLogs: 1 }), ["777"], 5n, 6n).ok, false);
});
test("replayVerdict fails if it reverted for another reason (e.g. root, output)", () => {
  assert.equal(replayVerdict(outcome({ simulated: { reverted: true, error: "UTXORootNotFound", args: ["1"], raw: "0x" } }), ["777"], 5n, 5n).ok, false);
  assert.equal(replayVerdict(outcome({ simulated: { reverted: true, error: "UTXOAlreadyOwned", args: ["1"], raw: "0x" } }), ["777"], 5n, 5n).ok, false);
});
test("replayVerdict fails if UTXOAlreadySpent names a different nullifier", () => {
  assert.equal(replayVerdict(outcome(), ["778"], 5n, 5n).ok, false);
});
test("replayVerdict fails if the root moved or the replay came from the original submitter", () => {
  assert.equal(replayVerdict(outcome(), ["777"], 5n, 6n).ok, false);
  assert.equal(replayVerdict(outcome({ replayFrom: "0xaaaa" }), ["777"], 5n, 5n).ok, false);
});

test("liveCommitments removes node-reported spends", () => {
  const txs: TxShape[] = [{ label: "M", inputs: [], outputs: ["10", "0"] }, { label: "T", inputs: ["n"].map(() => "0"), outputs: ["20", "30"] }];
  assert.deepEqual(liveCommitments(txs, [coin("10")]), ["20", "30"]);
});

test("Book refuses an overdraft and conserves the total", () => {
  const b = new Book();
  b.mint("A", 100);
  b.move("A", "B", 30);
  assert.equal(b.expected("A") + b.expected("B"), b.totalMinted);
  assert.throws(() => b.move("B", "A", 31));
});
