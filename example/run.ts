/**
 * run.ts — a confidential inter-desk position transfer on Paladin + Zeto, end to end.
 *
 * A central desk mints a private position to desk A; desk A moves part of it to desk B
 * twice; desk B moves some back, spending both notes it received. Every check below is an
 * assertion: if the claim it tests is false, the run exits 1.
 *
 *   0. Chain and source           — what we are talking to, read live
 *   1. Adversarial control        — arm (a): a second spend of an already-spent note
 *   2. Deploy + mint              — Zeto_AnonNullifier (primary) and Zeto_Anon (foil)
 *   3. Confidential transfers     — T1, T2 (A -> B), T3 (B -> A, spends both notes)
 *   4. Boundary leaks, on purpose — arm (c) leaks, arm (b) linkability probe
 *   5. Reconciliation             — book vs each desk's node vs on-chain commitments
 *   6. Observer view              — tools/observer/lib.ts on T3
 *
 * Safety boundary: no proof is constructed, altered or forged anywhere in this run. The
 * §1 replay resubmits a genuine, already-mined transfer unchanged, on our own devnet.
 *
 * Prerequisites: the Task Zero devnet (docs/task-zero/TASK-ZERO-2026-09-26.md §1), then
 *   npm install && npm --prefix tools/observer install
 *   npm run example
 */
import {
  Book, Chain, Checks, DISCLOSURE_BANNER, SCENARIO, Token, Transcript, connect, equalityLinks, idToDec,
  leakShape, liveCommitments, loadConfig, nonzero, plaintextHits, replayVerdict, submitterTopicMatches,
  trueSpends, words32, writeJson, type Coin, type NodeReceipt, type ObservedTx, type Party, type TxShape,
} from "./src/index.ts";

const t = new Transcript();
t.say(DISCLOSURE_BANNER);

const cfg = loadConfig();
const checks = new Checks(t);
const chain = new Chain(cfg.besuRpc);
const record: Record<string, unknown> = { date: new Date().toISOString(), besuRpc: cfg.besuRpc, nodes: cfg.nodes };

const PRIMARY = "Zeto_AnonNullifier";
const FOIL = "Zeto_Anon";

interface Step {
  label: string;
  receipt: NodeReceipt;
  tx: ObservedTx;
}
const shape = (s: Step): TxShape => ({ label: s.label, inputs: s.tx.event.inputs, outputs: s.tx.event.outputs });
const short = (v: string) => (v.length > 18 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v);

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  t.section("0. Chain and source");
  // -------------------------------------------------------------------------
  const chainId = await chain.chainId();
  const client = await chain.clientVersion();
  const head = await chain.blockNumber();
  t.say(`  base ledger   ${cfg.besuRpc}  chainId=${chainId}  client=${client}  head=#${head}`);
  for (const n of cfg.nodes) t.say(`  paladin node  ${n.id} ${n.url}`);
  t.say("  Paladin v1.0.0 pins Zeto v0.2.2 (CLAIMS E-2); the ABIs used to decode are the v0.2.2 ones.");
  t.say("  The Paladin version is not re-read by this script; E-3 records the install.");
  record.chain = { chainId: chainId.toString(), client, head };

  const { party } = connect(cfg);
  const issuer = party(cfg.issuer, 2);
  const A = party(cfg.deskA, 0);
  const B = party(cfg.deskB, 1);
  t.say(`  parties       issuer=${issuer.lookup}  deskA=${A.lookup}  deskB=${B.lookup}`);

  // -------------------------------------------------------------------------
  t.section("1. Adversarial control — a second spend of an already-spent note (arm a)");
  // -------------------------------------------------------------------------
  t.say("  A fresh control token; desk A spends one note to desk B; then the SAME mined");
  t.say("  transfer (the node's own valid proof, unmodified) is resubmitted from a fresh EOA.");
  const control = await Token.deploy(cfg, PRIMARY, issuer);
  t.say(`  control token ${control.address} (${PRIMARY})`);
  await control.mint(issuer, A, 10_000);
  const c0 = await control.transfer(A, B, 100);
  const c0tx = await chain.observe("C0", PRIMARY, control.address, c0.hash);
  const c0Nullifiers = nonzero(c0tx.event.inputs);
  t.say(`  C0 mined      ${c0.hash}  real nullifiers=${c0Nullifiers.length}`);
  const rootBefore = await chain.getRoot(PRIMARY, control.address);
  const replay = await chain.replay(PRIMARY, c0.hash);
  const rootAfter = await chain.getRoot(PRIMARY, control.address);
  t.say(`  replay        ${replay.replayHash} from ${replay.replayFrom}`);
  t.say(`  simulated     ${replay.simulated.error ?? "(no decoded error)"}(${replay.simulated.args.map(short).join(", ")})`);
  t.say(`  mined         status=${replay.receiptStatus} logs=${replay.receiptLogs} block=#${replay.blockNumber}`);
  const v = replayVerdict(replay, c0Nullifiers, rootBefore, rootAfter);
  checks.check("1", "replay of a spent note is rejected on chain with UTXOAlreadySpent(its nullifier), status 0, root unchanged", v.ok, v.reasons.join("; ") || undefined);
  const cA = await control.balanceOf(A);
  const cB = await control.balanceOf(B);
  checks.check("1", "no desk was credited twice: A=9900, B=100 after the replay", cA.total === 9_900n && cB.total === 100n, `A=${cA.total} B=${cB.total}`);
  record.control = { token: control.address, c0: c0.hash, replay, rootBefore, rootAfter, verdict: v };

  // -------------------------------------------------------------------------
  t.section("2. Deploy + mint — Zeto_AnonNullifier (primary) and Zeto_Anon (linkability foil)");
  // -------------------------------------------------------------------------
  const runs: Record<string, { token: Token; book: Book; steps: Step[] }> = {};
  for (const variant of [PRIMARY, FOIL]) {
    const token = await Token.deploy(cfg, variant, issuer);
    const book = new Book();
    const r = await token.mint(issuer, A, SCENARIO.mint);
    book.mint(A.name, SCENARIO.mint);
    const tx = await chain.observe("MINT", variant, token.address, r.hash);
    runs[variant] = { token, book, steps: [{ label: "MINT", receipt: r, tx }] };
    t.say(`  ${variant.padEnd(19)} token ${token.address}  mint ${r.hash}`);
    t.say(`    mint caller (public)  ${tx.observation.summary.from_eoa}   outputs on chain: ${nonzero(tx.event.outputs).length} commitment(s) (amount: see the §4 plaintext check)`);
  }

  // -------------------------------------------------------------------------
  t.section("3. Confidential transfers — T1, T2: A -> B; T3: B -> A spending both of B's notes");
  // -------------------------------------------------------------------------
  const plan: Array<[string, Party, Party, number]> = [
    ["T1", A, B, SCENARIO.t1],
    ["T2", A, B, SCENARIO.t2],
    ["T3", B, A, SCENARIO.t3],
  ];
  for (const variant of [PRIMARY, FOIL]) {
    const run = runs[variant];
    for (const [label, from, to, amount] of plan) {
      const r = await run.token.transfer(from, to, amount);
      run.book.move(from.name, to.name, amount);
      const tx = await chain.observe(label, variant, run.token.address, r.hash);
      run.steps.push({ label, receipt: r, tx });
      t.say(`  ${variant.padEnd(19)} ${label} ${from.name}->${to.name}  ${r.hash}  block #${tx.observation.summary.blockNumber}`);
    }
  }
  const domainErrs = new Set(Object.values(runs).flatMap((r) => r.steps.map((s) => s.receipt.domainReceiptError)).filter(Boolean));
  if (domainErrs.size) t.say(`  node domain receipt: ${[...domainErrs].join(" | ")}  (CLAIMS F-6; the state lists are used instead)`);

  // -------------------------------------------------------------------------
  t.section("4. Boundary leaks, run on purpose (arm c) and the linkability probe (arm b)");
  // -------------------------------------------------------------------------
  for (const variant of [PRIMARY, FOIL]) {
    const { steps } = runs[variant];
    t.say(`\n  ${variant}`);
    t.say("  tx    submitter EOA (public, indexed)          real in/pad  real out/pad  block time  gasUsed");
    for (const s of steps) {
      const sh = leakShape(shape(s));
      const sum = s.tx.observation.summary;
      t.say(`  ${s.label.padEnd(5)} ${sum.from_eoa}  ${`${sh.realInputs}/${sh.paddedInputs}`.padEnd(11)}  ${`${sh.realOutputs}/${sh.paddedOutputs}`.padEnd(12)}  ${String(sum.blockTime).padEnd(10)}  ${sum.gasUsed}`);
      checks.check("4c", `${variant} ${s.label}: submitter in the event equals tx.from and is an indexed topic`,
        s.tx.event.submitter.toLowerCase() === sum.from_eoa.toLowerCase() && submitterTopicMatches(s.tx.event.submitterTopic, sum.from_eoa));
      if (s.label !== "MINT") {
        checks.check("4c", `${variant} ${s.label}: zero padding reveals the real note count (${sh.realInputs} in, ${sh.realOutputs} out), matching the node's receipt`,
          sh.realInputs === s.receipt.spent.length && sh.realOutputs === s.receipt.created.filter((c) => s.tx.event.outputs.includes(idToDec(c.id))).length,
          `node spent=${s.receipt.spent.length}`);
      }
    }
    const xfers = steps.filter((s) => s.label !== "MINT");
    const gas = xfers.map((s) => Number(s.tx.observation.summary.gasUsed));
    t.say(`  transfer gas, observed in this run (data-dependent, E-10): ${gas.join(" · ")}  range ${Math.min(...gas)}–${Math.max(...gas)}`);
    const times = steps.map((s) => s.tx.observation.summary.blockTime);
    checks.check("4c", `${variant}: every tx's block timestamp is public and non-decreasing`, times.every((x, i) => i === 0 || x >= times[i - 1]), `timestamps ${times.join(", ")}`);
    const t1 = steps.find((s) => s.label === "T1")!, t2 = steps.find((s) => s.label === "T2")!;
    const same = t1.tx.observation.summary.from_eoa === t2.tx.observation.summary.from_eoa;
    t.say(`  observation: T1 and T2 (both desk A) were submitted by ${same ? "the SAME" : "different"} EOA${same ? " — an observer can group them by sender node (per-epoch submit key, E-8)" : ""}`);

    // Plaintext search: amounts and owner keys must not appear as whole words anywhere public.
    const coins: Coin[] = steps.flatMap((s) => [...s.receipt.created, ...s.receipt.spent]);
    const secrets = [
      ...[...new Set(coins.map((c) => c.amount))].map((a) => ({ label: `amount ${a}`, value: a })),
      ...[SCENARIO.mint, SCENARIO.t1, SCENARIO.t2, SCENARIO.t3].map((a) => ({ label: `amount ${a}`, value: BigInt(a) })),
      ...[...new Set(coins.map((c) => c.owner))].map((o) => ({ label: `owner key ${short(o)}`, value: BigInt(o) })),
    ];
    const pub = steps.flatMap((s) => [
      ...words32(s.tx.calldata, true),
      ...s.tx.observation.logs.flatMap((l) => [...words32(l.data), ...l.topics.map((x) => BigInt(x))]),
    ]);
    const hits = plaintextHits(pub, secrets);
    checks.check("4c", `${variant}: no amount or owner key (${secrets.length} secrets) appears as a plain 32-byte word in any calldata, log data or topic`, hits.length === 0, hits.join(", ") || undefined);
  }

  t.say("\n  Linkability probe (arm b): does any later on-chain input equal an earlier on-chain output?");
  for (const variant of [PRIMARY, FOIL]) {
    const { steps } = runs[variant];
    const shapes = steps.map(shape);
    const links = equalityLinks(shapes);
    const t3 = steps.find((s) => s.label === "T3")!;
    const truth = trueSpends(t3.receipt.spent, shapes.filter((x) => x.label === "T1" || x.label === "T2"));
    const truthFrom = [...new Set(truth.map((l) => l.from))].sort();
    checks.check("4b", `${variant}: ground truth is non-vacuous — desk B's node reports T3 spent its notes from T1 and T2`,
      truth.length === 2 && truthFrom.join(",") === "T1,T2", `true spends from ${truthFrom.join(", ") || "(none)"}`);
    t.say(`  ${variant}: ${links.length} equality link(s)${links.length ? ": " + links.map((l) => `${l.from}->${l.to}`).join(", ") : ""}`);
    if (variant === FOIL) {
      const t3Links = links.filter((l) => l.to === "T3").map((l) => l.value).sort();
      checks.check("4b", `${FOIL} (foil): T3's inputs ARE the commitments T1 and T2 created — linkable on chain`,
        t3Links.join() === truth.map((l) => l.value).sort().join(), `T3 links: ${t3Links.map(short).join(", ") || "(none)"}`);
    } else {
      checks.check("4b", `${PRIMARY}: no on-chain value equality links T3 (or any tx) to the notes it spent — nullifiers, not commitments, are published`,
        links.length === 0, links.map((l) => `${l.from}->${l.to} ${short(l.value)}`).join("; ") || undefined);
    }
  }
  t.say("  Not tested by this probe: correlation by submitter EOA, timing, note count or gas (all public,");
  t.say("  above). The anonymity set of a nullifier spend is the tree's contents, here a handful of notes.");

  // -------------------------------------------------------------------------
  t.section("5. Reconciliation — book vs each desk's node vs on-chain commitments");
  // -------------------------------------------------------------------------
  for (const variant of [PRIMARY, FOIL]) {
    const { token, book, steps } = runs[variant];
    const bal = { [A.name]: await token.balanceOf(A), [B.name]: await token.balanceOf(B) };
    for (const d of [A, B]) {
      checks.check("5", `${variant}: ${d.name}'s node balance equals the book (${book.expected(d.name)})`,
        bal[d.name].total === book.expected(d.name) && !bal[d.name].overflow, `node says ${bal[d.name].total} in ${bal[d.name].states} note(s)`);
    }
    const sum = bal[A.name].total + bal[B.name].total;
    checks.check("5", `${variant}: positions are conserved — desk balances sum to the ${book.totalMinted} minted`, sum === book.totalMinted, `sum=${sum}`);
    const spentAll = steps.flatMap((s) => s.receipt.spent);
    const live = liveCommitments(steps.map(shape), spentAll);
    const createdById = new Map(steps.flatMap((s) => s.receipt.created).map((c) => [idToDec(c.id), c]));
    const liveOpened = live.map((x) => createdById.get(x));
    const liveSum = liveOpened.reduce((a, c) => a + (c?.amount ?? 0n), 0n);
    checks.check("5", `${variant}: live on-chain commitments (${live.length}) = notes the desks' nodes hold (${bal[A.name].states + bal[B.name].states})`,
      live.length === bal[A.name].states + bal[B.name].states);
    checks.check("5", `${variant}: every live commitment opens (node-private) to a coin, and the openings sum to the mint`,
      liveOpened.every(Boolean) && liveSum === book.totalMinted, `sum of openings=${liveSum}`);
  }

  // -------------------------------------------------------------------------
  t.section("6. Observer view — tools/observer/lib.ts on T3 (Zeto_AnonNullifier)");
  // -------------------------------------------------------------------------
  const t3 = runs[PRIMARY].steps.find((s) => s.label === "T3")!;
  const obsPath = writeJson(cfg.outDir, "observer-T3-anonnullifier.json", { token: PRIMARY, tokenContract: runs[PRIMARY].token.address, tx: t3.receipt.hash, observer: t3.tx.observation, nodePrivate: { created: t3.receipt.created, spent: t3.receipt.spent, domainReceiptError: t3.receipt.domainReceiptError } });
  const s3 = t3.tx.observation.summary;
  t.say("  PUBLIC (any full-chain observer):");
  t.say(`    submitter EOA ${s3.from_eoa}  -> contract ${s3.to}  nonce ${s3.nonce}`);
  t.say(`    block #${s3.blockNumber} time ${s3.blockTime}  gasUsed ${s3.gasUsed} (observed in this run, data-dependent)  calldata ${s3.calldata_bytes} B`);
  t.say(`    method ${t3.tx.observation.method.signature}`);
  t.say(`    nullifiers ${t3.tx.event.inputs.map(short).join(", ")}`);
  t.say(`    outputs    ${t3.tx.event.outputs.map(short).join(", ")}`);
  t.say("    plus the SMT root, the Groth16 proof (8 field elements) and the data blob");
  t.say("  NODE-PRIVATE (desk B's node; not on chain):");
  for (const c of t3.receipt.spent) t.say(`    spent   ${short(c.id)}  amount ${c.amount}  owner ${short(c.owner)}`);
  for (const c of t3.receipt.created) t.say(`    created ${short(c.id)}  amount ${c.amount}  owner ${short(c.owner)}`);
  t.say(`  full observation (raw tx/receipt/block + decoded) -> ${obsPath}`);
  checks.check("6", "observer output: T3 decoded against the v0.2.2 ABI, status 1, tx.to is the token", s3.status === 1 && s3.to?.toLowerCase() === runs[PRIMARY].token.address);

  // -------------------------------------------------------------------------
  record.runs = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, {
    token: r.token.address,
    steps: r.steps.map((s) => ({ label: s.label, hash: s.receipt.hash, from: s.tx.observation.summary.from_eoa, block: s.tx.observation.summary.blockNumber, blockTime: s.tx.observation.summary.blockTime, gasUsed: s.tx.observation.summary.gasUsed, inputs: s.tx.event.inputs, outputs: s.tx.event.outputs, nodeSpent: s.receipt.spent.map((c) => c.id), nodeCreated: s.receipt.created.map((c) => c.id) })),
  }]));
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
const logPath = t.write(cfg.outDir, "run-latest.log");
writeJson(cfg.outDir, "run-latest.json", record);
console.log(`\ntranscript -> ${logPath}`);
process.exitCode = failed.length || crashed || checks.results.length === 0 ? 1 : 0;
