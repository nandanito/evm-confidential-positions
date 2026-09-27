/**
 * The auditor-view verdicts must be able to FAIL. Each test feeds a fixture where the claim is
 * false and asserts the verdict says so, alongside the fixture where it holds. No devnet and
 * no Zeto artifacts needed: plaintexts are built directly, hashed with poseidon-lite (the
 * Poseidon that Zeto's zkp/js uses).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { poseidon4 } from "poseidon-lite";
import {
  attempt, authorityLength, authorityVerdict, observerVerdict, parseAuthority, receiverSubsetVerdict, rotationVerdict,
  type Point, type Witness,
} from "../src/envelopes.ts";

const hash4 = (x: bigint[]) => poseidon4(x);
const A: Point = [11n, 12n];
const B: Point = [21n, 22n];
const c = (v: bigint, s: bigint, k: Point) => hash4([v, s, k[0], k[1]]);

// T1: A spends two notes (60 + 40) into B 10 and A 90.
const witness: Witness = {
  senderKey: A,
  inputs: [{ value: 60n, salt: 101n, real: true }, { value: 40n, salt: 102n, real: true }],
  outputs: [{ ownerKey: B, value: 10n, salt: 201n }, { ownerKey: A, value: 90n, salt: 202n }],
};
const plain = [A[0], A[1], 60n, 101n, 40n, 102n, B[0], B[1], A[0], A[1], 10n, 201n, 90n, 202n];
const onchainOutputs = [c(10n, 201n, B), c(90n, 202n, A)];
const earlierOutputs = [c(60n, 101n, A), c(40n, 102n, A)];
const good = { plain, witness, onchainOutputs, earlierOutputs, hash4 };

test("authority layout follows the v0.2.2 circuit: 2 + 2·nIn + 4·nOut fields", () => {
  assert.equal(authorityLength(2, 2), 14);
  const p = parseAuthority(plain);
  assert.deepEqual(p.senderKey, A);
  assert.deepEqual(p.inputs[1], { value: 40n, salt: 102n });
  assert.deepEqual(p.outputs[0], { ownerKey: B, value: 10n, salt: 201n });
  assert.throws(() => parseAuthority(plain.slice(0, 13)));
});

test("authorityVerdict passes when the plaintext is E-4's full tuple and checks against the chain", () => {
  assert.deepEqual(authorityVerdict(good), { ok: true, reasons: [] });
});

test("authorityVerdict fails when the plaintext is short (e.g. only the receiver's fields)", () => {
  assert.equal(authorityVerdict({ ...good, plain: [10n, 201n] }).ok, false);
});

test("authorityVerdict fails when a field differs from the witness", () => {
  const bad = [...plain];
  bad[2] = 61n; // input 0 value
  assert.equal(authorityVerdict({ ...good, plain: bad }).ok, false);
});

test("authorityVerdict fails when an output does not hash to its on-chain slot", () => {
  assert.equal(authorityVerdict({ ...good, onchainOutputs: [onchainOutputs[1], onchainOutputs[0]] }).ok, false);
});

test("authorityVerdict fails when a real input names no earlier on-chain commitment", () => {
  assert.equal(authorityVerdict({ ...good, earlierOutputs: [earlierOutputs[0]] }).ok, false);
});

test("authorityVerdict fails when there is no real input to check", () => {
  const w: Witness = { ...witness, inputs: witness.inputs.map((x) => ({ ...x, real: false })) };
  assert.equal(authorityVerdict({ ...good, witness: w }).ok, false);
});

const auth = parseAuthority(plain);
const fail = attempt(() => {
  throw new Error("The last ciphertext element must match the second item of the permuted state");
});
const receiverGood = {
  own: { ok: true as const, plain: [10n, 201n] },
  slot: 0,
  receiverKey: B,
  onchainOutputs,
  authority: auth,
  authorityEnvelopeWithReceiverKey: fail,
  otherSlotsWithReceiverKey: [fail],
  hash4,
};

test("receiverSubsetVerdict passes for the receiver's own (value, salt) only", () => {
  assert.deepEqual(receiverSubsetVerdict(receiverGood), { ok: true, reasons: [] });
});

test("receiverSubsetVerdict fails when the receiver key also opens the authority envelope", () => {
  assert.equal(receiverSubsetVerdict({ ...receiverGood, authorityEnvelopeWithReceiverKey: { ok: true, plain } }).ok, false);
});

test("receiverSubsetVerdict fails when the receiver key opens another output's slot", () => {
  assert.equal(receiverSubsetVerdict({ ...receiverGood, otherSlotsWithReceiverKey: [{ ok: true, plain: [90n, 202n] }] }).ok, false);
});

test("receiverSubsetVerdict fails when the receiver's fields are not the authority's for that slot", () => {
  assert.equal(receiverSubsetVerdict({ ...receiverGood, slot: 1 }).ok, false);
});

test("receiverSubsetVerdict fails when the receiver cannot open its own slot", () => {
  assert.equal(receiverSubsetVerdict({ ...receiverGood, own: fail }).ok, false);
});

test("receiverSubsetVerdict fails when the receiver sees as much as the authority", () => {
  assert.equal(receiverSubsetVerdict({ ...receiverGood, authority: { senderKey: A, inputs: [], outputs: [] } }).ok, false);
});

test("observerVerdict: passes only when every attempt fails and no secret is a plain word", () => {
  assert.equal(observerVerdict({ attempts: [fail, fail], plaintextHits: [] }).ok, true);
  assert.equal(observerVerdict({ attempts: [fail, { ok: true, plain: [1n] }], plaintextHits: [] }).ok, false);
  assert.equal(observerVerdict({ attempts: [fail], plaintextHits: ["value 10"] }).ok, false);
  assert.equal(observerVerdict({ attempts: [], plaintextHits: [] }).ok, false, "vacuous: nothing attempted");
});

test("rotationVerdict: each tx opens with exactly its own key", () => {
  const cells = [
    { tx: "T1", key: "K1", ok: true }, { tx: "T1", key: "K2", ok: false },
    { tx: "T2", key: "K1", ok: false }, { tx: "T2", key: "K2", ok: true },
  ];
  assert.equal(rotationVerdict(cells, { T1: "K1", T2: "K2" }).ok, true);
  assert.equal(rotationVerdict(cells.map((x) => (x.tx === "T1" && x.key === "K2" ? { ...x, ok: true } : x)), { T1: "K1", T2: "K2" }).ok, false, "new key reads the past");
  assert.equal(rotationVerdict(cells.map((x) => (x.tx === "T1" && x.key === "K1" ? { ...x, ok: false } : x)), { T1: "K1", T2: "K2" }).ok, false, "old key lost its own tx");
  assert.equal(rotationVerdict(cells.filter((x) => x.tx === "T1"), { T1: "K1" }).ok, false, "one tx does not exercise rotation");
});
