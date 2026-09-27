# Example — a confidential inter-desk position transfer

A central desk mints a private position to **desk A**. Desk A moves part of it to **desk B**
twice. Desk B then moves some back, and to do so its node has to spend **both** notes it
received. Everything runs on the local Paladin + Besu devnet from Task Zero, on
`Zeto_AnonNullifier` (the primary variant) and on `Zeto_Anon` (the foil that shows what the
nullifier variant adds).

> **A study on a local devnet, not for value.** The Groth16 verifiers use Zeto's shipped
> **UNSAFE** test keys (no phase-2 contribution, δ=γ; `CLAIMS.md` E-5, P-2). Each Paladin node
> holds every key and all plaintext for its desks (E-8, P-10). No public audit of either
> project was found in the searched corpus (E-11). Nothing here is secure, audited,
> non-custodial or production-ready (P-1).

[`run.ts`](run.ts) is the walkthrough. Every numbered section ends in assertions, and the run
exits 1 if any claim it tests turns out false. The latest transcript is
[`out/run-latest.log`](out/run-latest.log), the machine-readable record (every tx hash, gas
figure, input and output) is [`out/run-latest.json`](out/run-latest.json), and the full
observer output for T3 is [`out/observer-T3-anonnullifier.json`](out/observer-T3-anonnullifier.json).
Each run overwrites those; the runs cited in `CLAIMS.md` E-10 and E-14..E-17 are kept as
`out/run-2026-09-27a.*`, `b.*` (after the Codex review fixes) and `c.*` (the step 3 re-run for
the README, E-21).

A second walkthrough, [`run-auditor.ts`](run-auditor.ts), covers the **auditor view**: the
non-repudiation variant, which is not on the Paladin devnet. It is deployed standalone and run
on the same Besu node. See [the non-repudiation auditor view](#the-non-repudiation-auditor-view-run-auditorts) below.

## Run it

```sh
kubectl -n paladin get pods          # the devnet must be up: see the README's Getting started
npm ci && npm --prefix tools/observer ci
npm run example                      # the walkthrough, 1 min 25 s to ~3 min on the devnet (see below if it times out)
npm test                             # probe unit tests + the disclosure-gate falsification tests
npm run check:disclosure             # the disclosure gate on its own

npm run setup:auditor                # once: Zeto v0.2.2 contracts, circuit, UNSAFE test keys -> artifacts/ (streams 1.27 GB)
npm run example:auditor              # the auditor walkthrough, ~40 s to 2.5 min (E-21); needs only the devnet's Besu
```

Environment overrides (`BESU_RPC`, `NODES_JSON`, `ZETO_DOMAIN`, `POLL_MS`, `ISSUER`, `DESK_A`,
`DESK_B`, `OUT_DIR`) are in [`src/config.ts`](src/config.ts).

**If `npm run example` stops at "Failed while waiting for receipt".** On a heavily loaded host,
Paladin's sequencer can cancel the Zeto proof request after about 10 s and retry it, and the
transfer lands minutes after the walkthrough's 60 s wait. That happened three times on
2026-09-27. Restarting the three Paladin pods fixed it: their state is on PVCs. `POLL_MS` raises
the wait. The record, with the node log lines, is
[`docs/step3/RUNS-2026-09-27.md`](../docs/step3/RUNS-2026-09-27.md) (E-21).

## The sections

| § | What happens | What is asserted |
|---|---|---|
| 0 | Reads the chain id and Besu client version live; names the three Paladin nodes | — (context) |
| 1 | **Arm (a).** On a separate control token, desk A spends one note to desk B, and then that mined transfer is **resubmitted unchanged** from a fresh EOA | The contract reverts with `UTXOAlreadySpent(<that transfer's nullifier>)`, the mined replay has status 0 and no logs, the SMT root is unchanged, and neither desk is credited twice |
| 2 | Deploys a fresh `Zeto_AnonNullifier` and a fresh `Zeto_Anon`, and mints 100,000 to desk A on each | — (the mint's public fields are checked in §4) |
| 3 | T1: A→B 1,000. T2: A→B 700. T3: B→A 1,500, which forces desk B's node to spend both of its notes | Each transfer succeeds on chain and decodes against the v0.2.2 ABI |
| 4 | **Arm (c)**, the leaks, run on purpose; then **arm (b)**, the linkability probe | See below |
| 5 | Reconciliation | Each desk's node balance equals the off-chain book; balances sum to the mint; the live on-chain commitments are exactly the notes the nodes hold, and their node-private openings sum to the mint |
| 6 | The observer view of T3, produced by [`tools/observer/lib.ts`](../tools/observer/lib.ts) (the Task Zero harness logic, reused and not copied) | The tx decodes, has status 1, and targets the token |

**Why arm (a) is a real double-spend test.** In Zeto v0.2.2 `validateTransactionProposal`
checks nullifiers before outputs and the root (`zeto_nullifier.sol:60-71`, `:88-89`). So a
`UTXOAlreadySpent` naming the original nullifier tells you *which* check rejected the replay,
not just that something did. The replay reuses the node's own valid proof. No proof is
built, changed or forged anywhere in this example.

**Arm (b): what the probe tests, exactly.** It asks whether any later on-chain input equals
any earlier on-chain output. On `Zeto_Anon` it should, because inputs *are* the commitments
being spent. On `Zeto_AnonNullifier` it should not, because inputs are nullifiers. The probe
is only meaningful if the spend really happened, so it first checks against desk B's own node
receipt that T3 spent the notes from T1 and T2. Without that check, "no link found" could
just mean "nothing to link". Both variants pass that ground-truth check. `Zeto_Anon` then shows
the links (T1→T3, T2→T3, and desk A's change T1→T2), and `Zeto_AnonNullifier` shows none.

**Arm (c): the leaks.** For every tx the run asserts four things:
- the submitter in the event equals `tx.from` and sits in an indexed topic;
- the zero padding reveals the real number of input and output notes, and that number matches
  the node's receipt;
- block timestamps are public;
- no amount and no owner key appears as a plain 32-byte word in any calldata, log data or topic.

It also prints the gas each transfer used. That figure is observed in that run and is
data-dependent (E-10).

## The non-repudiation auditor view (`run-auditor.ts`)

> **Not for value, and not Paladin.** Zeto_AnonEncNullifierNonRepudiation runs here on Zeto
> v0.2.2's **UNSAFE** test keys (E-5, P-2). Paladin v1.0.0 cannot drive this variant, so the
> walkthrough deploys the Zeto v0.2.2 release contracts to the devnet's Besu node and proves
> client-side. This one process holds every desk's and every authority's key. The contract
> owner sets the authority key, and can rotate it or upgrade the contract at any time (P-7).

Why standalone: Paladin v1.0.0's Zeto domain has no configuration entry for the variant and no
circuit or key for it in the image. Its code has no arbiter handling at all (0 grep hits). The
commands are in [`docs/step2/AUDITOR-VARIANT-2026-09-27.md`](../docs/step2/AUDITOR-VARIANT-2026-09-27.md) §1.

| § | What happens | What is asserted |
|---|---|---|
| 0 | Chain, Zeto tag and commit, the sha256 of every fetched artifact | The verification key has δ = γ (the UNSAFE test key, E-5) |
| 1 | Deploys Poseidon, SmtLib, five verifiers and the implementation, behind a UUPS proxy owned by the issuer | The proxy points at the implementation; the verifier's code equals the release artifact; the issuer owns it; **the arbiter is unset (0, 0)** |
| 2 | `setArbiter(K1)` | It takes effect; **its receipt has 0 logs**; a non-owner call reverts `OwnableUnauthorizedAccount` |
| 3 | Mint 100,000 to desk A (two notes) | The on-chain outputs are the notes; the desks' tree root equals `getRoot()` |
| 4 | T1: A → B 1,000, spending both notes, proven for K1 | Accepted; decodes as `UTXOTransferNonRepudiation` |
| 5 | Desk B proves T2 for K1; the owner rotates to K2; T2 is re-proven for K2 and submitted | No event in the rotation block; K1 before, K2 in the rotation's own block (no timelock); the K1 proof is now rejected (`Invalid proof`); the rotation calldata shows the new key |
| 6 | The three views of T1 and T2 | See the table below |
| 7 | Every transfer × every authority key | Each transfer opens only with the key set when it was proven |
| 8 | Leaks and reconciliation | Submitter = `tx.from`, indexed; note count via padding; live notes sum to the mint |

What each party decrypts, per transfer (E-19):

| Party | Decrypts | Checked by |
|---|---|---|
| **The non-repudiation authority** | 14 fields: the sender's key, (value, salt) of every input, every output owner's key, and (value, salt) of every output | Equality with the witness. Each output hashes to its on-chain commitment. Each real input hashes to an **earlier** on-chain commitment, so the authority can name the note every nullifier spent |
| **The receiver** | 2 fields: (value, salt) of its own output | Hashes to its commitment. Its key opens neither the authority envelope nor the other output. A strict subset of the non-repudiation authority's view (F-4(b)) |
| **A full-chain observer** | nothing | 9 fresh-key decryption attempts per transfer fail. No value, salt or desk key appears as a plain 32-byte word. A control finds the arbiter key in the rotation calldata, so the search is not blind |

The transcripts are `out/auditor-latest.log` and `out/auditor-latest.json`. The runs cited in
`CLAIMS.md` E-19 and E-20 are kept as `out/auditor-2026-09-27a.*` (before the Codex review),
`out/auditor-2026-09-27b.*` (after it) and `out/auditor-2026-09-27c.*` (the step 3 re-run).

## What is NOT hidden

Read this before quoting anything from the run.

- **Who submits.** Every transfer carries the submitter EOA in the clear, and it is an indexed
  event topic (F-1, P-4). That EOA is the node's submit key, not the desk's owner key. In the
  recorded run, T1 and T2 (both from desk A) came from the **same** EOA, so an observer can
  group them by sending node. The code reuses the key for a 100-block epoch (E-8); this run
  observes that behaviour but does not prove the rule.
- **How many notes.** Zero padding reveals the exact number of real inputs and outputs of every
  transfer: 1-in/2-out for T1 and T2, 2-in/2-out for T3 (P-6).
- **When.** Block number and timestamp are public for every transfer.
- **Gas.** Public on every transfer. For the nullifier variant it depends on the data (the
  depth of the sparse-Merkle-tree insert), so it varies from transfer to transfer (E-10). Never
  budget with a single figure.
- **Mint.** The minting EOA and the number of minted notes are public. In the recorded run the
  mints on *two different* token contracts came from the **same** EOA, while desk A's transfers
  used a different EOA per contract. This is an observation; the mechanism was not
  investigated.
- **The anonymity set.** A nullifier spend proves membership in the tree. In this run the tree
  holds a handful of notes, so an observer's candidate set is that small. Arm (b) tests value
  equality only. It does **not** test correlation by EOA, timing, note count or gas, and all
  four are public.
- **Everything, to the node.** Each desk's own Paladin node holds its amounts, owners and
  history in plaintext (E-8, P-10). §6 prints what desk B's node holds for T3.
- **On `Zeto_Anon`, the whole spend graph.** That is the point of the foil (§4 arm b).
- **Everything, to the non-repudiation authority** (`run-auditor.ts` only). The key holder
  decrypts the sender, both receivers and every amount of every transfer. It can also link each
  nullifier spend to the note it consumed, so history masking does not hold against the
  authority (E-19).
- **The authority's key, and every rotation.** `getArbiter()` is a public view. `setArbiter`
  emits no event, but it is an ordinary transaction: its calldata carries the new key, sent from
  the owner's EOA (E-20).

## What is NOT demonstrated

- **Soundness.** The keys are Zeto's UNSAFE test keys. Arm (a) shows the *nullifier set*
  rejects a replayed spend. It says nothing about whether someone could produce a fresh
  accepted proof, and on these keys that is a known weakness (E-5, P-2). We did not test it and
  will not.
- **Deposit and withdraw.** Not run. Per the Zeto source they publish the amount and the
  caller's EOA (P-4), but this example deploys no ERC-20 and does not execute them.
- **A third-party decryption view in `run.ts`.** None of the four stock variants has one (P-5).
  The non-repudiation view is shown only in `run-auditor.ts`, on a standalone deployment.
- **The non-repudiation variant on Paladin.** Paladin v1.0.0 cannot drive it (E-19).
- **Custody separation in `run-auditor.ts`.** One process holds every desk's and authority's key.
  Nothing here shows how an authority key would be generated, held or handed over.
- **An upgrade that removes the authority, or a rotation made through another contract.** Both
  stay inference (E-20). The stale-key rejection was simulated, not mined.
- **The qurrency (post-quantum) authority.** At Zeto v0.2.2 its circuit has no authority
  envelope (GAP-7). Its related finding (F-3) is withheld pending coordinated disclosure.
- **Non-repudiation deposit, withdraw, batch (10×10) and locks.** Not run.
- **`Zeto_AnonEnc`.** The receiver-ciphertext foil from the roadmap is not in this walkthrough.
  Task Zero's observer run covers it (E-7).
- **Separate operators.** One machine runs all three nodes, so every property that depends on
  independent parties on independent infrastructure is not shown.
- **Latency.** No timings are reported. End-to-end latency (B-1) and nullifier-variant proving
  time (B-2), including the non-repudiation circuit, are still pending and not measured.
- **Scale.** One scenario, three transfers per variant, on a near-empty tree.
- **Anything about Paladin itself beyond v1.0.0.** Its version is not re-read by this script
  (E-3 records the install). The Zeto domain receipt returns `PD210102: Not implemented` on
  v1.0.0 (F-6), so the node's receipt state lists are used instead.

## Layout

| File | What it is |
|---|---|
| `run.ts` | The walkthrough, sections 0–6 |
| `src/config.ts` | Endpoints, identities, the scenario's amounts |
| `src/paladin.ts` | Deploy/mint/transfer through the Paladin SDK; node-private balance and receipt states |
| `src/chain.ts` | Base-ledger reads through `tools/observer/lib.ts`; `getRoot`; the replay |
| `src/probes.ts` | The three arms as pure functions over observed data |
| `src/book.ts` | The off-chain position book reconciled in §5 |
| `src/report.ts` | The disclosure banner, the transcript and the check registry |
| `tests/probes.test.ts` | Unit tests: each probe fails on a fixture where its claim is false |
| `run-auditor.ts` | The auditor walkthrough, sections 0–8 (standalone non-repudiation variant) |
| `src/zeto-v022.ts` | Paths to, and checks on, the Zeto v0.2.2 artifacts fetched by `tools/fetch-zeto-v0.2.2.sh` |
| `src/standalone.ts` | Deploy, set the arbiter, mint, prove and submit with ethers + snarkjs + Zeto's zkp/js |
| `src/envelopes.ts` | The authority / receiver / observer / rotation verdicts, as pure functions |
| `tests/envelopes.test.ts` | Unit tests: each verdict fails on a fixture where its claim is false |
| `out/` | The latest runs of both walkthroughs (transcript, JSON record, observer output) and the dated runs cited in `CLAIMS.md` |

The disclosure gate ([`tools/check-disclosure.ts`](../tools/check-disclosure.ts)) scans this
file, `run.ts`, `src/` and `out/`, so a sentence here that claims more than `CLAIMS.md` supports
fails `npm run check:disclosure`.
