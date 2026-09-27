/**
 * The three views of a non-repudiation transfer — authority, receiver, full-chain observer —
 * as pure functions over decrypted plaintexts, so each verdict can be unit-tested without a
 * devnet (example/tests/envelopes.test.ts). Decryption itself is Zeto's own
 * `poseidonDecrypt` (zkp/js @ v0.2.2), passed in by the caller.
 *
 * The authority plaintext layout is the v0.2.2 circuit's
 * (`basetokens/anon_enc_nullifier_non_repudiation_base.circom`, the `plainText` array):
 *   [senderKey.x, senderKey.y,
 *    (inputValue_i, inputSalt_i)       for i < nInputs,
 *    (outputOwnerKey_j.x, .y)          for j < nOutputs,
 *    (outputValue_j, outputSalt_j)     for j < nOutputs]
 * The receiver's envelope for output j is (outputValue_j, outputSalt_j), ECDH to its owner.
 */

export type Point = [bigint, bigint];
export type Hash4 = (x: bigint[]) => bigint;

export interface AuthorityPlaintext {
  senderKey: Point;
  inputs: { value: bigint; salt: bigint }[];
  outputs: { ownerKey: Point; value: bigint; salt: bigint }[];
}

export function authorityLength(nInputs: number, nOutputs: number): number {
  return 2 + 2 * nInputs + 4 * nOutputs;
}

/** Split an authority plaintext into named fields; throws on the wrong length. */
export function parseAuthority(plain: bigint[], nInputs = 2, nOutputs = 2): AuthorityPlaintext {
  const n = authorityLength(nInputs, nOutputs);
  if (plain.length !== n) throw new Error(`authority plaintext has ${plain.length} fields, expected ${n}`);
  const inputs = Array.from({ length: nInputs }, (_, i) => ({ value: plain[2 + 2 * i], salt: plain[3 + 2 * i] }));
  const k = 2 + 2 * nInputs;
  const v = k + 2 * nOutputs;
  const outputs = Array.from({ length: nOutputs }, (_, j) => ({
    ownerKey: [plain[k + 2 * j], plain[k + 2 * j + 1]] as Point,
    value: plain[v + 2 * j],
    salt: plain[v + 2 * j + 1],
  }));
  return { senderKey: [plain[0], plain[1]], inputs, outputs };
}

export type Attempt = { ok: true; plain: bigint[] } | { ok: false; error: string };

/** Run a decryption and report failure instead of throwing (a wrong key throws in poseidonDecrypt). */
export function attempt(fn: () => bigint[]): Attempt {
  try {
    return { ok: true, plain: fn() };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export interface Verdict {
  ok: boolean;
  reasons: string[];
}
const verdict = (reasons: string[]): Verdict => ({ ok: reasons.length === 0, reasons });

/** What the prover put in the witness: the ground truth the non-repudiation authority's view is compared with. */
export interface Witness {
  senderKey: Point;
  inputs: { value: bigint; salt: bigint; real: boolean }[];
  outputs: { ownerKey: Point; value: bigint; salt: bigint }[];
}

/**
 * The authority learns exactly what CLAIMS E-4 says — the input owner key, every input value
 * and salt, every output owner key, value and salt — if all hold:
 *  - the plaintext has the circuit's length and equals the witness field for field;
 *  - independently of the witness: every output (value, salt, ownerKey) hashes to the on-chain
 *    output commitment in its slot, and every real input (value, salt, senderKey) hashes to a
 *    commitment an EARLIER transaction put on chain — so the authority can name the note each
 *    nullifier spent, which no observer can (history masking does not apply to it).
 */
export function authorityVerdict(a: {
  plain: bigint[];
  witness: Witness;
  onchainOutputs: bigint[];
  earlierOutputs: bigint[];
  hash4: Hash4;
}): Verdict {
  const r: string[] = [];
  const nIn = a.witness.inputs.length;
  const nOut = a.witness.outputs.length;
  let p: AuthorityPlaintext;
  try {
    p = parseAuthority(a.plain, nIn, nOut);
  } catch (e: any) {
    return verdict([e.message]);
  }
  if (p.senderKey[0] !== a.witness.senderKey[0] || p.senderKey[1] !== a.witness.senderKey[1]) r.push("sender key differs from the witness");
  p.inputs.forEach((x, i) => {
    const w = a.witness.inputs[i];
    if (x.value !== w.value || x.salt !== w.salt) r.push(`input ${i} (value, salt) differs from the witness`);
  });
  p.outputs.forEach((x, j) => {
    const w = a.witness.outputs[j];
    if (x.value !== w.value || x.salt !== w.salt || x.ownerKey[0] !== w.ownerKey[0] || x.ownerKey[1] !== w.ownerKey[1]) r.push(`output ${j} differs from the witness`);
    const h = a.hash4([x.value, x.salt, x.ownerKey[0], x.ownerKey[1]]);
    if (h !== a.onchainOutputs[j]) r.push(`output ${j} does not hash to the on-chain commitment in its slot`);
  });
  const earlier = new Set(a.earlierOutputs.map(String));
  p.inputs.forEach((x, i) => {
    if (!a.witness.inputs[i].real) return;
    const h = a.hash4([x.value, x.salt, p.senderKey[0], p.senderKey[1]]);
    if (!earlier.has(String(h))) r.push(`real input ${i} does not hash to any earlier on-chain commitment`);
  });
  if (!a.witness.inputs.some((x) => x.real)) r.push("the witness has no real input: nothing to check the input fields against");
  return verdict(r);
}

/**
 * The receiver's view is a strict subset of the authority's (CLAIMS F-4(b)) if all hold:
 *  - the receiver decrypts its own slot to (value, salt), which hashes to the on-chain
 *    commitment with its own key, and equals the authority's fields for that slot;
 *  - the receiver's key opens neither the authority envelope nor any other output's slot;
 *  - the authority's plaintext carries fields the receiver's does not.
 */
export function receiverSubsetVerdict(a: {
  own: Attempt;
  slot: number;
  receiverKey: Point;
  onchainOutputs: bigint[];
  authority: AuthorityPlaintext;
  authorityEnvelopeWithReceiverKey: Attempt;
  otherSlotsWithReceiverKey: Attempt[];
  hash4: Hash4;
}): Verdict {
  const r: string[] = [];
  if (!a.own.ok) return verdict([`receiver could not decrypt its own slot: ${a.own.error}`]);
  if (a.own.plain.length !== 2) r.push(`receiver plaintext has ${a.own.plain.length} fields, expected 2 (value, salt)`);
  const [value, salt] = a.own.plain;
  if (a.hash4([value, salt, a.receiverKey[0], a.receiverKey[1]]) !== a.onchainOutputs[a.slot]) r.push("receiver's (value, salt) does not hash to its on-chain commitment");
  const o = a.authority.outputs[a.slot];
  if (!o || o.value !== value || o.salt !== salt) r.push("receiver's fields are not the authority's fields for the same slot");
  if (a.authorityEnvelopeWithReceiverKey.ok) r.push("the receiver's key opened the authority envelope");
  a.otherSlotsWithReceiverKey.forEach((x, i) => {
    if (x.ok) r.push(`the receiver's key opened another output's slot (#${i})`);
  });
  const authorityFields = 2 + 2 * a.authority.inputs.length + 4 * a.authority.outputs.length;
  if (!(authorityFields > a.own.plain.length)) r.push("the non-repudiation authority's view is not larger than the receiver's");
  return verdict(r);
}

/**
 * A full-chain observer decrypts nothing if: every decryption it can attempt fails (we try
 * keys it could plausibly hold — fresh random keys — against every envelope; this cannot
 * cover every key), and no secret appears as a whole 32-byte word in any public data.
 */
export function observerVerdict(a: { attempts: Attempt[]; plaintextHits: string[] }): Verdict {
  const r: string[] = [];
  if (a.attempts.length === 0) r.push("no decryption was attempted: the check would be vacuous");
  const opened = a.attempts.filter((x) => x.ok).length;
  if (opened) r.push(`${opened} of ${a.attempts.length} observer decryption attempts succeeded`);
  if (a.plaintextHits.length) r.push(`secrets appear as plain words: ${a.plaintextHits.join(", ")}`);
  return verdict(r);
}

/**
 * Key rotation: each transfer's authority envelope opens with exactly the arbiter key that was
 * set when it was proven, and with no other key tried.
 */
export function rotationVerdict(cells: { tx: string; key: string; ok: boolean }[], expected: Record<string, string>): Verdict {
  const r: string[] = [];
  const txs = Object.keys(expected);
  if (txs.length < 2) r.push("fewer than two transfers: rotation is not exercised");
  for (const tx of txs) {
    const row = cells.filter((c) => c.tx === tx);
    if (row.length < 2) r.push(`${tx}: fewer than two keys tried`);
    for (const c of row) {
      if (c.key === expected[tx] && !c.ok) r.push(`${tx} does not open with ${c.key}, the key set when it was proven`);
      if (c.key !== expected[tx] && c.ok) r.push(`${tx} also opens with ${c.key}`);
    }
    if (!row.some((c) => c.key === expected[tx])) r.push(`${tx}: its own key was not tried`);
  }
  return verdict(r);
}
