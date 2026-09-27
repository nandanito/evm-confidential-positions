/**
 * run-auditor.ts — the auditor view: Zeto_AnonEncNullifierNonRepudiation, end to end.
 *
 * The four Zeto variants on the Paladin devnet give no third party a decryption view (CLAIMS
 * P-5). The non-repudiation variant does: every transfer carries an envelope for an
 * "arbiter" (the authority) that the owner sets with setArbiter. Paladin v1.0.0 cannot drive
 * this variant, so this walkthrough deploys the Zeto v0.2.2 release contracts to the same
 * Besu node and proves client-side (docs/step2/AUDITOR-VARIANT-2026-09-27.md §1).
 *
 *   0. Chain and source    — Besu, the pinned Zeto artifacts, the verification key
 *   1. Deploy              — UUPS proxy, owned by the issuer; the arbiter starts unset
 *   2. Set the arbiter     — K1; what marks the change on chain
 *   3. Mint                — 100,000 to desk A as two notes
 *   4. T1                  — desk A -> desk B 1,000, spending both notes, under K1
 *   5. Rotate              — owner sets K2; a transfer proven for K1 is now rejected; T2 under K2
 *   6. Three views         — authority vs receiver vs full-chain observer, for T1 and T2
 *   7. Rotation matrix     — which key opens which transfer
 *   8. Leaks and reconciliation
 *
 * Every numbered section ends in assertions; the run exits 1 if any claim it tests is false.
 * Safety boundary: every proof is an honest proof of an honest witness. Nothing is forged or
 * altered; the stale-key transfer in §5 is an honest proof made before a rotation, and it is
 * only simulated.
 *
 * Prerequisites: the Task Zero devnet's Besu (docs/task-zero/TASK-ZERO-2026-09-26.md §1), then
 *   npm install && npm run setup:auditor && npm run example:auditor
 */
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { Chain, type ObservedTx } from "./src/chain.ts";
import { loadConfig } from "./src/config.ts";
import {
  attempt, authorityLength, authorityVerdict, observerVerdict, parseAuthority, receiverSubsetVerdict, rotationVerdict,
  type Attempt, type Point,
} from "./src/envelopes.ts";
import { leakShape, nonzero, plaintextHits, submitterTopicMatches, words32 } from "./src/probes.ts";
import { Checks, Transcript, bigintSafe, writeJson } from "./src/report.ts";
import { NR_TOKEN, PATHS, ZETO_COMMIT, ZETO_TAG, artifact, assertArtifacts, zkpJs } from "./src/zeto-v022.ts";

/** Printed before anything else, so no startup failure can exit above it. */
const BANNER = [
  "================================================================================",
  " NON-REPUDIATION AUDITOR VIEW — A STUDY ON A LOCAL DEVNET. NOT FOR VALUE.",
  " - The Groth16 keys are Zeto v0.2.2's shipped UNSAFE test keys (no phase-2 setup;",
  "   delta = gamma). They give no soundness for real value (CLAIMS.md E-5, P-2).",
  " - Zeto_AnonEncNullifierNonRepudiation is NOT on the Paladin devnet; it is deployed",
  "   here standalone, and this one process holds every desk's and authority's key.",
  " - The authority key is set by the contract owner and can be rotated at any time",
  "   (P-7); the owner can also upgrade the contract (UUPS).",
  " - The submitter EOA, timing, gas and note count are public (F-1, P-4, P-6).",
  " - No public audit of Zeto or Paladin was found in the searched corpus (E-11).",
  "================================================================================",
].join("\n");

const t = new Transcript();
t.say(BANNER);

const cfg = loadConfig();
const outDir = process.env.OUT_DIR || new URL("./out/", import.meta.url).pathname;
const checks = new Checks(t);
const chain = new Chain(cfg.besuRpc);
const record: Record<string, unknown> = { date: new Date().toISOString(), besuRpc: cfg.besuRpc, zeto: { tag: ZETO_TAG, commit: ZETO_COMMIT } };
const short = (v: unknown) => {
  const s = String(v);
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
};
const pt = (p: Point) => `(${short(p[0])}, ${short(p[1])})`;
const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main(): Promise<void> {
  assertArtifacts();
  // Loaded after the artifact check: it needs the git-ignored zkp/js at module load.
  const S = await import("./src/standalone.ts");
  const zk = zkpJs();
  const decrypt = (ct: bigint[], key: bigint[], nonce: bigint, len: number) => zk.poseidonDecrypt(ct, key, nonce, len);

  // -------------------------------------------------------------------------
  t.section("0. Chain and source");
  // -------------------------------------------------------------------------
  const chainId = await chain.chainId();
  const client = await chain.clientVersion();
  t.say(`  base ledger   ${cfg.besuRpc}  chainId=${chainId}  client=${client}  head=#${await chain.blockNumber()}`);
  t.say(`  Zeto          ${ZETO_TAG} @ ${ZETO_COMMIT} (the version Paladin v1.0.0 pins, CLAIMS E-2)`);
  t.say(`  artifacts     ${PATHS.manifest}`);
  for (const line of readFileSync(PATHS.manifest, "utf8").trim().split("\n").slice(2)) t.say(`    ${line}`);
  const vkey = JSON.parse(readFileSync(PATHS.vkey, "utf8"));
  checks.check("0", "the verification key is an UNSAFE test key: vk_delta_2 equals vk_gamma_2 (E-5)", JSON.stringify(vkey.vk_delta_2) === JSON.stringify(vkey.vk_gamma_2), `nPublic=${vkey.nPublic}`);
  record.chain = { chainId: chainId.toString(), client };

  const provider = chain.provider;
  const wallet = (name: string) => {
    const w = ethers.Wallet.createRandom().connect(provider);
    t.say(`  EOA ${name.padEnd(8)} ${w.address}  (fresh, gasPrice 0)`);
    return w;
  };
  const issuerEoa = wallet("issuer");
  const deskAEoa = wallet("deskA");
  const deskBEoa = wallet("deskB");
  const outsider = wallet("outsider");
  const A = S.newBjjKey("deskA");
  const B = S.newBjjKey("deskB");
  const K1 = S.newBjjKey("authority-K1");
  const K2 = S.newBjjKey("authority-K2");
  t.say(`  Baby Jubjub keys (held in this process): deskA ${pt(A.pub)}  deskB ${pt(B.pub)}  K1 ${pt(K1.pub)}  K2 ${pt(K2.pub)}`);

  // -------------------------------------------------------------------------
  t.section("1. Deploy — Zeto v0.2.2 release artifacts behind a UUPS proxy, owned by the issuer");
  // -------------------------------------------------------------------------
  const dep = await S.deployNonRepudiation(issuerEoa);
  for (const d of dep.txs) t.say(`  ${d.what.padEnd(52)} ${d.hash}  gas ${d.gasUsed}`);
  t.say(`  token (proxy) ${dep.proxy}   implementation ${dep.implementation}`);
  const tokenAsIssuer = S.token(dep.proxy, issuerEoa);
  const implSlot = await provider.getStorage(dep.proxy, EIP1967_IMPL_SLOT);
  checks.check("1", "the proxy's EIP-1967 implementation slot points at the deployed implementation (UUPS, owner-upgradeable)", BigInt(implSlot) === BigInt(dep.implementation));
  const verifierCode = await provider.getCode(dep.verifier);
  const verifierArt = artifact(PATHS.contract("verifiers/verifier_anon_enc_nullifier_non_repudiation.sol", "Groth16Verifier_AnonEncNullifierNonRepudiation"));
  checks.check("1", "the deployed transfer verifier's runtime code equals the v0.2.2 release artifact (the UNSAFE-key verifier)", verifierCode.toLowerCase() === verifierArt.deployedBytecode.toLowerCase());
  checks.check("1", "the issuer is the owner", (await tokenAsIssuer.owner()).toLowerCase() === issuerEoa.address.toLowerCase());
  const arb0 = (await tokenAsIssuer.getArbiter()).map(BigInt);
  checks.check("1", "the arbiter is NOT set at deploy: getArbiter() is (0, 0) until the owner calls setArbiter (E-4)", arb0[0] === 0n && arb0[1] === 0n, `getArbiter()=${pt(arb0 as Point)}`);
  record.deployment = dep;

  // -------------------------------------------------------------------------
  t.section("2. Set the arbiter (K1) — what marks the change?");
  // -------------------------------------------------------------------------
  const set1 = await (await tokenAsIssuer.setArbiter(K1.pub, { gasPrice: 0n })).wait();
  t.say(`  setArbiter(K1)  ${set1.hash}  block #${set1.blockNumber}  logs=${set1.logs.length}  gas ${set1.gasUsed}`);
  checks.check("2", "setArbiter(K1) took effect: getArbiter() = K1", sameKey((await tokenAsIssuer.getArbiter()).map(BigInt), K1.pub));
  checks.check("2", "setArbiter emits no event: its receipt has 0 logs", set1.logs.length === 0);
  let outsiderErr: string | null = null;
  try {
    await S.token(dep.proxy, outsider).setArbiter.staticCall(K2.pub);
  } catch (e: any) {
    outsiderErr = e?.revert?.name ?? e?.shortMessage ?? String(e?.message ?? e);
  }
  checks.check("2", "a non-owner cannot set the arbiter: the call reverts OwnableUnauthorizedAccount", outsiderErr === "OwnableUnauthorizedAccount", `revert: ${outsiderErr}`);

  // -------------------------------------------------------------------------
  t.section("3. Mint — the issuer mints 100,000 to desk A as two notes (60,000 + 40,000)");
  // -------------------------------------------------------------------------
  const tree = new S.Tree();
  const mintNotes = [S.newNote(A, 60_000n), S.newNote(A, 40_000n)];
  const mintRc = await (await tokenAsIssuer.mint(mintNotes.map((n) => n.commitment), "0x", { gasPrice: 0n })).wait();
  const mint = await chain.observe("MINT", NR_TOKEN, dep.proxy, mintRc.hash);
  await tree.add(mint.event.outputs.map(BigInt));
  t.say(`  mint ${mintRc.hash}  by ${mint.observation.summary.from_eoa}  outputs ${nonzero(mint.event.outputs).length}  gas ${mint.observation.summary.gasUsed}`);
  checks.check("3", "the mint's on-chain outputs are the two commitments, and the desks' tree root equals getRoot()",
    mint.event.outputs.map(String).join() === mintNotes.map((n) => String(n.commitment)).join() && (await tree.root()) === (await chain.getRoot(NR_TOKEN, dep.proxy)));

  // -------------------------------------------------------------------------
  t.section("4. T1 — desk A -> desk B 1,000, spending both of A's notes, proven for K1");
  // -------------------------------------------------------------------------
  const t1Out = [S.newNote(B, 1_000n), S.newNote(A, 99_000n)];
  const t1p = await S.proveTransfer({ sender: A, inputs: mintNotes, outputs: t1Out, tree, arbiter: K1.pub });
  const t1rc = await S.submitTransfer(dep.proxy, deskAEoa, t1p);
  const t1 = await chain.observe("T1", NR_TOKEN, dep.proxy, t1rc.hash);
  await tree.add(t1.event.outputs.map(BigInt));
  t.say(`  T1 ${t1rc.hash}  block #${t1rc.blockNumber}  submitter ${t1.observation.summary.from_eoa}  gas ${t1.observation.summary.gasUsed} (observed in this run, data-dependent)`);
  checks.check("4", "T1 is accepted on chain, decodes as UTXOTransferNonRepudiation, and the tree root tracks getRoot()",
    t1.event.name === "UTXOTransferNonRepudiation" && (await tree.root()) === (await chain.getRoot(NR_TOKEN, dep.proxy)));

  // -------------------------------------------------------------------------
  t.section("5. Rotate — the owner sets K2; a transfer proven for K1 is rejected; T2 under K2");
  // -------------------------------------------------------------------------
  const bNote = t1Out[0];
  const t2Out = [S.newNote(A, 600n), S.newNote(B, 400n)];
  t.say("  Desk B proves T2 (B -> A 600) for the current arbiter K1, but has not submitted it yet.");
  const staleT2 = await S.proveTransfer({ sender: B, inputs: [bNote], outputs: t2Out, tree, arbiter: K1.pub });
  checks.check("5", "control: before the rotation, the K1-proven T2 would be accepted (simulated)", (await S.simulateTransfer(dep.proxy, deskBEoa, staleT2)) === null);
  const set2 = await (await tokenAsIssuer.setArbiter(K2.pub, { gasPrice: 0n })).wait();
  t.say(`  setArbiter(K2)  ${set2.hash}  block #${set2.blockNumber}  logs=${set2.logs.length}`);
  const tokenLogsInBlock = await provider.getLogs({ address: dep.proxy, fromBlock: set2.blockNumber, toBlock: set2.blockNumber });
  checks.check("5", "the rotation emits no event: 0 logs in its receipt, 0 logs from the token in its block", set2.logs.length === 0 && tokenLogsInBlock.length === 0);
  const before = (await tokenAsIssuer.getArbiter({ blockTag: set2.blockNumber - 1 })).map(BigInt);
  const at = (await tokenAsIssuer.getArbiter({ blockTag: set2.blockNumber })).map(BigInt);
  checks.check("5", "no timelock: getArbiter() is K1 in the block before the rotation and K2 in the rotation's own block", sameKey(before, K1.pub) && sameKey(at, K2.pub));
  const staleErr = await S.simulateTransfer(dep.proxy, deskBEoa, staleT2);
  t.say(`  the K1-proven T2, simulated after the rotation: ${staleErr}`);
  checks.check("5", "after the rotation the same K1-proven T2 is rejected ('Invalid proof'): the key is read from storage at verify time", staleErr === "Invalid proof");
  const rotTx = await provider.getTransaction(set2.hash);
  const rotCall = new ethers.Interface(artifact(PATHS.contract("zeto_anon_enc_nullifier_non_repudiation.sol", NR_TOKEN)).abi).parseTransaction({ data: rotTx!.data });
  const rotKey = (rotCall?.args[0] as bigint[]).map(BigInt);
  t.say(`  but the rotation tx itself is public: ${rotCall?.signature} from ${rotTx!.from}, new key ${pt(rotKey as Point)} in the calldata`);
  checks.check("5", "an observer reading transactions (not logs) sees the rotation: the setArbiter calldata carries the new key K2 in the clear", sameKey(rotKey, K2.pub) && rotTx!.from.toLowerCase() === issuerEoa.address.toLowerCase());

  const t2p = await S.proveTransfer({ sender: B, inputs: [bNote], outputs: t2Out, tree, arbiter: K2.pub });
  const t2rc = await S.submitTransfer(dep.proxy, deskBEoa, t2p);
  const t2 = await chain.observe("T2", NR_TOKEN, dep.proxy, t2rc.hash);
  await tree.add(t2.event.outputs.map(BigInt));
  t.say(`  T2 ${t2rc.hash}  block #${t2rc.blockNumber}  submitter ${t2.observation.summary.from_eoa}  gas ${t2.observation.summary.gasUsed} (observed in this run, data-dependent)`);
  checks.check("5", "T2, proven for K2, is accepted after the rotation, and the tree root tracks getRoot()",
    t2.event.name === "UTXOTransferNonRepudiation" && (await tree.root()) === (await chain.getRoot(NR_TOKEN, dep.proxy)));

  // -------------------------------------------------------------------------
  t.section("6. Three views of each transfer — authority, receiver, full-chain observer");
  // -------------------------------------------------------------------------
  const allNotes = [...mintNotes, ...t1Out, ...t2Out];
  const secrets = [
    ...[...new Set(allNotes.map((n) => n.value))].map((v) => ({ label: `value ${v}`, value: v })),
    ...allNotes.map((n) => ({ label: `salt ${short(n.salt)}`, value: n.salt })),
    ...[A, B].flatMap((k) => [{ label: `${k.name} key.x`, value: k.pub[0] }, { label: `${k.name} key.y`, value: k.pub[1] }]),
  ];
  const publicWords = (o: ObservedTx) => [...words32(o.calldata, true), ...o.observation.logs.flatMap((l) => [...words32(l.data), ...l.topics.map((x) => BigInt(x))])];
  // Detector control: the arbiter key IS a plain word in the rotation calldata, so a miss below is not a blind detector.
  const control = plaintextHits(words32(rotTx!.data, true), [{ label: "K2.x", value: K2.pub[0] }, { label: "K2.y", value: K2.pub[1] }]);
  checks.check("6", "detector control: the plaintext search finds K2 in the setArbiter calldata", control.length === 2);

  const views: Record<string, unknown> = {};
  const cases = [
    { label: "T1", tx: t1, p: t1p, authority: K1, receiver: B, earlier: [mint] },
    { label: "T2", tx: t2, p: t2p, authority: K2, receiver: A, earlier: [mint, t1] },
  ];
  for (const c of cases) {
    const f = c.tx.event.fields as any;
    const nonce = BigInt(f.encryptionNonce);
    const ecdh: Point = [BigInt(f.ecdhPublicKey[0]), BigInt(f.ecdhPublicKey[1])];
    const envA: bigint[] = f.encryptedValuesForAuthority.map(BigInt);
    const envR: bigint[] = f.encryptedValuesForReceiver.map(BigInt);
    const outs = c.tx.event.outputs.map(BigInt);
    const slot = (i: number) => envR.slice(4 * i, 4 * i + 4);
    t.say(`\n  ${c.label}`);

    // (a) authority
    const auth = attempt(() => decrypt(envA, S.sharedKey(c.authority, ecdh), nonce, authorityLength(2, 2)));
    const av = authorityVerdict({
      plain: auth.ok ? auth.plain : [],
      witness: c.p.witness,
      onchainOutputs: outs,
      earlierOutputs: c.earlier.flatMap((e) => e.event.outputs.map(BigInt)),
      hash4: S.hash4,
    });
    if (auth.ok) {
      const pa = parseAuthority(auth.plain);
      t.say(`    NON-REPUDIATION AUTHORITY (${c.authority.name}) decrypts ${auth.plain.length} fields from the ${envA.length}-element envelope:`);
      t.say(`      sender key ${pt(pa.senderKey)}  (${nameOf(pa.senderKey, [A, B])})`);
      pa.inputs.forEach((x, i) => t.say(`      input ${i}: value ${x.value}  salt ${short(x.salt)}${c.p.witness.inputs[i].real ? "  -> hashes to an earlier on-chain commitment: the non-repudiation authority names the note this nullifier spent" : "  (zero padding)"}`));
      pa.outputs.forEach((x, j) => t.say(`      output ${j}: owner ${nameOf(x.ownerKey, [A, B])}  value ${x.value}  salt ${short(x.salt)}  -> hashes to on-chain output ${j}`));
    }
    checks.check("6", `${c.label}: the authority decrypts exactly what E-4 says — input owner key, every input value and salt, every output owner key, value and salt — and each field checks against on-chain commitments`,
      auth.ok && av.ok, auth.ok ? av.reasons.join("; ") || undefined : `decrypt failed: ${(auth as any).error}`);

    // (b) receiver
    const own = attempt(() => decrypt(slot(0), S.sharedKey(c.receiver, ecdh), nonce, 2));
    const rv = receiverSubsetVerdict({
      own,
      slot: 0,
      receiverKey: c.receiver.pub,
      onchainOutputs: outs,
      authority: auth.ok ? parseAuthority(auth.plain) : { senderKey: [0n, 0n], inputs: [], outputs: [] },
      authorityEnvelopeWithReceiverKey: attempt(() => decrypt(envA, S.sharedKey(c.receiver, ecdh), nonce, authorityLength(2, 2))),
      otherSlotsWithReceiverKey: [attempt(() => decrypt(slot(1), S.sharedKey(c.receiver, ecdh), nonce, 2))],
      hash4: S.hash4,
    });
    if (own.ok) t.say(`    RECEIVER (${c.receiver.name}) decrypts its own slot only: value ${own.plain[0]}  salt ${short(own.plain[1])}   (2 fields; the authority got ${authorityLength(2, 2)})`);
    checks.check("6", `${c.label}: the receiver's view is a strict subset of the authority's (F-4(b)): its own (value, salt) only; its key opens neither the authority envelope nor the other output`, rv.ok, rv.reasons.join("; ") || undefined);

    // (c) observer
    const s = c.tx.observation.summary;
    t.say(`    OBSERVER sees: submitter ${s.from_eoa} (indexed), block #${s.blockNumber} t=${s.blockTime}, gas ${s.gasUsed}, calldata ${s.calldata_bytes} B,`);
    t.say(`      nullifiers ${c.tx.event.inputs.map(short).join(", ")}  outputs ${c.tx.event.outputs.map(short).join(", ")}`);
    t.say(`      encryptionNonce ${short(nonce)}  ecdhPublicKey ${pt(ecdh)}  ${envR.length} receiver + ${envA.length} authority ciphertext elements, the Groth16 proof`);
    const tries: Attempt[] = [];
    for (let i = 0; i < 3; i++) {
      const guess = S.newBjjKey(`observer-guess-${i}`);
      const k = S.sharedKey(guess, ecdh);
      tries.push(attempt(() => decrypt(envA, k, nonce, authorityLength(2, 2))), attempt(() => decrypt(slot(0), k, nonce, 2)), attempt(() => decrypt(slot(1), k, nonce, 2)));
    }
    const hits = plaintextHits(publicWords(c.tx), secrets);
    const ov = observerVerdict({ attempts: tries, plaintextHits: hits });
    checks.check("6", `${c.label}: the observer decrypts nothing — ${tries.length} attempts with keys it could hold all fail, and none of ${secrets.length} secrets appears as a plain 32-byte word in calldata, log data or topics`, ov.ok, ov.reasons.join("; ") || undefined);
    views[c.label] = { authority: auth.ok ? auth.plain : null, authorityVerdict: av, receiver: own.ok ? own.plain : null, receiverVerdict: rv, observerAttempts: tries.length, observerVerdict: ov };
  }
  record.views = views;

  // -------------------------------------------------------------------------
  t.section("7. Rotation matrix — which authority key opens which transfer");
  // -------------------------------------------------------------------------
  const cells: { tx: string; key: string; ok: boolean }[] = [];
  for (const c of cases) {
    const f = c.tx.event.fields as any;
    const ecdh: Point = [BigInt(f.ecdhPublicKey[0]), BigInt(f.ecdhPublicKey[1])];
    for (const k of [K1, K2]) {
      const r = attempt(() => decrypt(f.encryptedValuesForAuthority.map(BigInt), S.sharedKey(k, ecdh), BigInt(f.encryptionNonce), authorityLength(2, 2)));
      cells.push({ tx: c.label, key: k.name, ok: r.ok });
      t.say(`  ${c.label} (proven for ${c.authority.name}) with ${k.name}: ${r.ok ? "OPENS" : "does not open"}`);
    }
  }
  const rot = rotationVerdict(cells, { T1: K1.name, T2: K2.name });
  checks.check("7", "each transfer opens only with the arbiter key set when it was proven: K1 keeps T1 after the rotation, K2 cannot read it", rot.ok, rot.reasons.join("; ") || undefined);
  record.rotation = cells;

  // -------------------------------------------------------------------------
  t.section("8. Leaks and reconciliation");
  // -------------------------------------------------------------------------
  for (const [o, expIn, expOut, eoa] of [[mint, 0, 2, issuerEoa], [t1, 2, 2, deskAEoa], [t2, 1, 2, deskBEoa]] as const) {
    const sh = leakShape({ label: o.label, inputs: o.event.inputs, outputs: o.event.outputs });
    const sum = o.observation.summary;
    checks.check("8", `${o.label}: submitter in the event = tx.from = the desk's EOA, in an indexed topic`,
      o.event.submitter.toLowerCase() === sum.from_eoa.toLowerCase() && submitterTopicMatches(o.event.submitterTopic, sum.from_eoa) && sum.from_eoa.toLowerCase() === eoa.address.toLowerCase());
    if (o.label !== "MINT") checks.check("8", `${o.label}: zero padding reveals the note count (${expIn} in, ${expOut} out)`, sh.realInputs === expIn && sh.realOutputs === expOut, `${sh.realInputs}/${sh.paddedInputs} in, ${sh.realOutputs}/${sh.paddedOutputs} out`);
  }
  const gas = [t1, t2].map((o) => Number(o.observation.summary.gasUsed));
  t.say(`  NR transfer gas, observed in this run (data-dependent, E-10): ${gas.join(" · ")}  range ${Math.min(...gas)}–${Math.max(...gas)}`);
  const spent = new Set([...mintNotes, bNote].map((n) => String(n.commitment)));
  const live = allNotes.filter((n) => !spent.has(String(n.commitment)));
  const byDesk = (k: typeof A) => live.filter((n) => n.owner === k).reduce((a, n) => a + n.value, 0n);
  checks.check("8", "reconciliation: the live notes are A 99,600 (99,000 + 600) and B 400, summing to the 100,000 minted",
    byDesk(A) === 99_600n && byDesk(B) === 400n && byDesk(A) + byDesk(B) === 100_000n);
  record.txs = Object.fromEntries([mint, t1, t2].map((o) => [o.label, { hash: o.hash, from: o.observation.summary.from_eoa, block: o.observation.summary.blockNumber, gasUsed: o.observation.summary.gasUsed, inputs: o.event.inputs, outputs: o.event.outputs }]));
  record.arbiter = { set1: { hash: set1.hash, block: set1.blockNumber, logs: set1.logs.length }, set2: { hash: set2.hash, block: set2.blockNumber, logs: set2.logs.length }, staleT2: staleErr };
  writeJson(outDir, "observer-T1-nonrepudiation.json", { token: NR_TOKEN, tokenContract: dep.proxy, tx: t1.hash, observer: t1.observation });
}

function sameKey(a: bigint[], b: Point): boolean {
  return a.length === 2 && a[0] === b[0] && a[1] === b[1];
}
function nameOf(p: Point, keys: { name: string; pub: Point }[]): string {
  return keys.find((k) => sameKey(k.pub, p))?.name ?? "unknown key";
}

let crashed: unknown = null;
try {
  await main();
} catch (e) {
  crashed = e;
  t.say(`\nERROR: ${(e as Error)?.stack ?? e}`);
} finally {
  chain.destroy();
}

t.section("Summary");
const failed = checks.failed;
t.say(`  ${checks.results.length - failed.length}/${checks.results.length} checks passed${crashed ? "; the run CRASHED before finishing" : ""}.`);
for (const f of failed) t.say(`  FAIL [${f.section}] ${f.label}`);
t.say("  What this run does NOT show is listed in example/README.md (what is NOT hidden / NOT demonstrated).");
record.checks = checks.results;
record.crashed = crashed ? String(crashed) : null;
const logPath = t.write(outDir, "auditor-latest.log");
writeJson(outDir, "auditor-latest.json", JSON.parse(JSON.stringify(record, bigintSafe)));
console.log(`\ntranscript -> ${logPath}`);
try {
  const S = await import("./src/standalone.ts");
  await S.terminateProver();
} catch {
  // artifacts missing: the prover was never started
}
process.exitCode = failed.length || crashed || checks.results.length === 0 ? 1 : 0;
