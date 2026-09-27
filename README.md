# evm-confidential-positions

### What Zeto on Paladin actually hides, established by running it

[**The answer**](#the-honest-answer) · [**Trust model**](#trust-model) · [**Getting started**](#getting-started) · [**What is NOT hidden**](#what-is-not-hidden) · [**Open gaps**](#open-gaps) · [**Claims register**](CLAIMS.md)

---

**A reproducible research study, not a library or a product.**
[Zeto](https://github.com/LFDT-Paladin/zeto) is a set of zero-knowledge token contracts for EVM
chains: each balance is a hash commitment, and every transfer carries a Groth16 proof that it
balances. [Paladin](https://github.com/LFDT-Paladin/paladin) (LF Decentralized Trust) is a node
that runs private transactions such as Zeto's over an EVM chain; it holds its users' keys and
generates their proofs. This repository measures what that combination actually keeps from an
outside observer and who can still see everything. Every claim is tied to a row in a claims
register.

It is for engineers evaluating confidential tokens on EVM. You can re-decode the archived
transactions without installing anything, or re-run the evidence on a local devnet (three
paths, [below](#getting-started)). It is the EVM counterpart of an earlier study of XRPL's
XLS-96 confidential transfers ([comparison](#comparison-with-xls-96)).

**The scenario: a confidential inter-desk position book.** A central desk mints a private
position to desk A. Desk A moves part of it to desk B twice, and desk B moves some back. Each
desk runs on its own Paladin node, and the positions are Zeto tokens on a Besu chain. The
question this repository answers is what an outside observer of that chain can learn while
it happens, and who else can see the positions. We answered it by executing the flow with
adversarial checks, not by reading the documentation.

## The honest answer

**In the nullifier variant, Zeto hides the amounts and the owners of positions, and which
earlier note each transfer spends.** An observer sees commitments, nullifiers and a 256-byte
proof, not who paid whom or how much (E-6, E-9, E-15). **But it does not hide who submits.** The
submitter's EVM address is public and indexed on every transfer. So are the block time, the
gas, and the number of notes in and out, which the zero padding gives away (F-1, P-4, P-6).
Deposits and withdrawals publish the amount and the caller (E-22, P-4).

**Two parties can see everything.**
- **Your own Paladin node.** It holds every key and stores every amount in plaintext (E-8,
  P-10).
- **The non-repudiation authority, if you deploy that variant.** It decrypts the sender, the
  receivers and every amount, and can name the note each nullifier spent (E-19). The contract
  owner can swap its key at any time with no event or delay (E-20).

**No real value should go near it.** The Groth16 verifiers use Zeto's shipped **UNSAFE** test
keys (δ=γ, no phase-2 contribution), so they give no soundness for real value (E-5, P-2). No
public audit of either project was found in the searched corpus (E-11). Nothing here is secure,
audited, non-custodial or production-ready (P-1).

> **Reading the citations.** Every claim carries a row id from [`CLAIMS.md`](CLAIMS.md), the
> register that governs what this project may say. **`E-`** is established evidence, **`F-`** a
> finding about Zeto or Paladin, **`P-`** a standing prohibition (something this project must
> never claim), **`B-`** a pending measurement, and **`GAP-`** a named gap in
> [`GAPS-2026-09-26.md`](docs/task-zero/GAPS-2026-09-26.md). Where this README and a row
> disagree, the row wins.

<details>
<summary><b>Terms used below</b>: click to expand</summary>

| Term | What it means here |
|---|---|
| **Variant** | One of Zeto's token contracts, each with its own circuit. Paladin v1.0.0's devnet registers four: `Zeto_Anon`, `Zeto_AnonEnc`, `Zeto_AnonNullifier`, `Zeto_AnonNullifierKyc` (the "stock" variants) |
| **Note, commitment** | A position is held as notes (UTXOs). Each note is published only as a Poseidon hash of (value, salt, owner's Baby Jubjub public key) |
| **Nullifier** | In the nullifier variants, spending a note publishes a different hash of it, so an observer cannot match the spend to the note. In `Zeto_Anon` and `Zeto_AnonEnc` the spend names the note itself |
| **EOA, submitter** | The ordinary Ethereum account that sends a transaction. For Zeto on Paladin it is the node's submit key, not the position owner's key |
| **Paladin node** | The service each desk talks to. It holds the desk's keys, builds the proofs and submits the transactions |
| **Non-repudiation variant** | `Zeto_AnonEncNullifierNonRepudiation`, a variant that also encrypts every transfer to a designated key. Its holder is called the authority (or arbiter; the contract calls it `setArbiter`) |
| **Qurrency** | A post-quantum variant with the same aim. At the pinned version its circuit has no working authority envelope (GAP-7) |
| **Groth16, trusted setup** | The proof system Zeto uses. Each circuit needs a one-time setup ceremony whose secret must be destroyed |
| **UNSAFE test keys, δ=γ** | Zeto ships setup keys made without that ceremony step: two parameters a real ceremony makes independent are equal. Zeto labels them UNSAFE; they give no soundness for real value |
| **The pin** | Paladin v1.0.0 uses Zeto v0.2.2, not Zeto's latest release. Everything here is checked against v0.2.2 |
| **SMT** | The sparse Merkle tree of notes that a nullifier spend proves membership in. Its insert depth varies with the data, the mechanism behind varying nullifier gas (E-10) |
| **Besu, QBFT, gasPrice 0** | The devnet's Ethereum client and consensus. Gas is measured but costs nothing |
| **UUPS proxy** | An upgradeable-contract pattern: the owner can replace the contract's code |
| **Arms (a), (b), (c)** | The walkthrough's adversarial checks: (a) replay a spent note, (b) try to link spends to earlier notes, (c) measure what leaks |
| **T1–T3, K1/K2, runs a/b/c** | The walkthroughs' transfers, the two authority keys before and after a rotation, and the three archived runs of each walkthrough |
| **Foil** | `Zeto_Anon`, run next to `Zeto_AnonNullifier` to show what nullifiers add |

</details>

## Status — 2026-09-27

- **Initial research, "Task Zero" (2026-09-26):** seven questions about Zeto on Paladin, answered with evidence in
  [`TASK-ZERO-2026-09-26.md`](docs/task-zero/TASK-ZERO-2026-09-26.md). Versions are pinned there:
  Paladin v1.0.0, which pins Zeto v0.2.2, 329 commits behind Zeto HEAD (E-2, P-3).
- **Worked example and disclosure gate (2026-09-27, roadmap step 1):** the scenario above,
  executed on the local devnet ([`example/`](example/), E-14..E-18).
- **Auditor variant (2026-09-27, step 2):** the non-repudiation variant, deployed standalone and run
  ([`AUDITOR-VARIANT-2026-09-27.md`](docs/step2/AUDITOR-VARIANT-2026-09-27.md), E-19, E-20).
- **This README (2026-09-27, step 3).** All three getting-started paths were re-run from
  `npm ci` for it, and one needed a node restart first
  ([`RUNS-2026-09-27.md`](docs/step3/RUNS-2026-09-27.md), E-21).
- **Next:** a hosted observer UI on a public testnet ([`ROADMAP.md`](docs/ROADMAP.md) step 4,
  not started). A trusted-setup ceremony is not planned unless the project ever holds value.

How many files, tests, checks and claims rows there are is under [By the numbers](#by-the-numbers).

## Evidence a stranger can check

Everything ran on a **local** devnet (Besu, chainId 1337), so none of the hashes below can be
looked up on a public block explorer. Instead, each archived run keeps the raw transaction,
receipt and block objects next to the decoded view. With the Zeto v0.2.2 ABIs in
[`tools/observer/abi/`](tools/observer/abi/) you can re-decode them without trusting our
summary. Pasteable public-testnet hashes are roadmap step 4.

**The observer outputs.** These are what a full-chain observer reads for one transfer, with
what the sending node privately holds alongside it:
- `Zeto_AnonNullifier`: [`observer-out-anonnullifier.json`](tools/observer/observer-out-anonnullifier.json),
  tx `0xd8ba191f…` (E-6).
- `Zeto_AnonEnc`: [`observer-out-anonenc.json`](tools/observer/observer-out-anonenc.json),
  tx `0x370054b0…` (E-7).
- The 2026-09-27 re-run ([Path A](#path-a--the-observer-only)):
  [`observer-out-anonnullifier-2026-09-27c.json`](tools/observer/observer-out-anonnullifier-2026-09-27c.json),
  tx `0xd47a88dc…` (E-21).

In each file:
- `observer.summary.from_eoa` is the submitter, and it also appears as an indexed log topic.
- The nullifier array contains zeros, which give away the note count.
- No amount appears anywhere in `observer.raw`.

The amounts are under `nodePrivate`, which is what the node holds.

**The archived walkthrough runs.** Each has a `.log` transcript that prints the UNSAFE banner
and a `.json` record with every tx hash, gas figure, input and output:
- [`example/out/run-2026-09-27{a,b,c}`](example/out/): the Paladin walkthrough (E-14..E-17).
- [`example/out/auditor-2026-09-27{a,b,c}`](example/out/): the non-repudiation walkthrough (E-19,
  E-20).

Run c is the 2026-09-27 re-run. Its hashes, shortened (the full ones are in `run-2026-09-27c.json` and `auditor-2026-09-27c.json`):

| Run c step | Tx | What to check in the `.json` |
|---|---|---|
| Replay of a spent note (arm a) | `0x422bc397…4410d` | status 0, no logs; the simulation reverts `UTXOAlreadySpent` (E-14) |
| `Zeto_AnonNullifier` T3, B→A, spending two notes | `0x5488f45f…ddedca` | two non-zero nullifiers, none equal to an earlier output (E-15) |
| `Zeto_Anon` T3, the same spend on the foil | `0x7df3546f…d27c1c` | its inputs equal T1's and T2's outputs, so the spend graph is public (E-15) |
| Non-repudiation T1 | `0x495654d9…2a1cfa` | the 16-element authority envelope in the event (E-19) |
| `setArbiter(K2)`, the key rotation | `0x6574f7f4…3ab66a` | 0 logs, and the new key in the calldata (E-20) |

**The gate on what may be said.** `npm run check:disclosure` scans this README, `docs/` and
`example/`. It fails on phrasings that `CLAIMS.md` prohibits. It is lexical, so it catches
phrasings, not meanings (E-18).

## How it fits together

There are two paths to the same chain. The Paladin path runs the stock variants through
Paladin nodes. The standalone path deploys the non-repudiation variant directly, because
Paladin v1.0.0 cannot drive it (E-19).

```text
 PALADIN PATH                             STANDALONE PATH
 example/run.ts, tools/observer           example/run-auditor.ts

 desk app                                 one process holds every desk key
   │ JSON-RPC, no auth on the devnet      and every authority key
   ▼                                        │
 Paladin node, one per group of desks       │ proves client-side: snarkjs +
   one BIP39 mnemonic -> every key          │ Zeto zkp/js @ v0.2.2
   proves in-process with the raw key       │ (UNSAFE test keys)
   plaintext coin data in its Postgres      │
   submits from a per-epoch EOA             │ submits from an ordinary EOA
   │ (100 blocks)                           │
   ▼                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Besu, QBFT, chainId 1337: the base ledger                                    │
│                                                                              │
│ Zeto_AnonNullifier, Zeto_Anon           Zeto_AnonEncNullifierNonRepudiation  │
│ deployed by Paladin's factory, v0.2.2   v0.2.2 release, behind a UUPS proxy  │
│ Groth16 verifiers: UNSAFE test keys     owner: mint, setArbiter, upgrade     │
└──────────────────────────────────────────────────────────────────────────────┘
   ▲
   │ reads tx, receipt, block and logs, and nothing else
 tools/observer/lib.ts: the full-chain observer
```

## Trust model

Four things carry trust beyond the chain itself.

**The Paladin node** (Paladin path). The node derives every key from one BIP39 mnemonic, which
is stored as an unencrypted Kubernetes Secret. It generates proofs in-process with the raw key
and stores coin data and history as plaintext in Postgres. The devnet's JSON-RPC has no
authentication. Whoever controls a node can read all of its tenants' positions and spend all
of them (E-8, P-10). Separate operators were not demonstrated: one machine ran all three nodes.

**The contract owner.** The owner mints, and on the non-repudiation variant sets the
authority key. The proxy is UUPS, so the owner can also upgrade the implementation (E-4, E-20).
The KYC registry, which this project did not deploy, is owner-only and has no revoke function
(E-4, by grep).

**The optional authority** (non-repudiation variant only, standalone path). Its key is set
after deployment by the owner's `setArbiter`.
- **What it sees.** The non-repudiation authority decrypts 14 fields of every transfer: the
  sender's key, both inputs' values and salts, both output owners' keys, and both outputs'
  values and salts. Each input it decrypts hashes to an earlier on-chain commitment, so it can
  name the note each nullifier spent. History masking does not hold against it (E-19).
- **What the receiver sees**, by comparison: its own output's value and salt, 2 fields
  (E-19, F-4(b)).
- **How the key changes (E-20).** The key is unset (0, 0) until `setArbiter` is called. A
  rotation emits no event and takes effect in its own block, with no timelock. A proof made
  for the old key is rejected after it (simulated, not mined). The old key still opens every transfer it could open
  before.
- **Rotations are visible.** A rotation is an ordinary transaction whose calldata carries the
  new key, sent from the owner's address (E-20, P-7).

The four variants on the Paladin devnet give no third party a decryption view. The Paladin
node that holds the keys sees everything (P-5, E-8), and on `Zeto_AnonEnc` a receiver can
decrypt its own note from the chain (E-7). The qurrency variant has no authority envelope at the pinned Zeto v0.2.2 (GAP-7).

**The trusted setup.** Zeto uses Groth16, which needs one setup ceremony per circuit (P-9).
The verifiers Paladin deploys use Zeto's own UNSAFE test keys. They have δ=γ in 32 of 32 v0.2.2
verifiers, confirmed against the bytecode on our devnet, and Zeto issue #186 was open on 2026-09-26. Forging
with δ=γ is a known result. This project records that from primary sources and will not
demonstrate it (E-5, P-2).

## What is confidential

- **Amounts and owners.** Each note is a Poseidon commitment to (value, salt, owner's Baby
  Jubjub key). No amount and no owner key appears as a plain 32-byte word in any calldata, log
  or topic (E-6, E-16). That is a whole-word check, not a proof against derived encodings.
- **Which note was spent** (nullifier variants only). Inputs are nullifiers, not commitments.
  In the recorded runs no later input equals an earlier output on `Zeto_AnonNullifier`, while
  on `Zeto_Anon` every spend links to the note it consumed (E-15).
- **From third parties, by default.** The four stock variants on the Paladin devnet give no
  third party a decryption view; the Paladin node that holds the keys sees everything (P-5,
  E-8). On `Zeto_AnonEnc` only the receiver can decrypt its note
  from the chain (E-7).

## What is NOT hidden

- **Who submits.** Every transfer carries the submitter EOA in the clear, as an indexed event
  topic. It is the node's submit key, reused for a 100-block epoch. In every recorded Paladin run,
  one desk's two transfers came from the same EOA, so an observer can group them (E-8, E-16, F-1,
  P-4).
- **How many notes.** Zero padding reveals the real number of inputs and outputs of every
  transfer (E-16, P-6).
- **When, and how much gas.** Block time and gas are public. Nullifier-variant gas depends on
  the data, so it varies from transfer to transfer (E-10).
- **Deposits, withdrawals and mints.** Per the Zeto source, deposit and withdraw publish the
  amount and the caller's address. The examples do not run them (E-22, P-4). The minting EOA and the
  note count of every mint are public (E-16).
- **The size of the anonymity set.** A nullifier spend proves membership in the tree. On a
  near-empty tree that set is small.
- **Timing, EOA or gas correlation.** Arm (b) of the walkthrough tests linkability by value
  equality only. Correlation by these public fields was not tested (E-15).
- **Everything, to the sender's own node** (E-8, P-10).
- **Everything, to the non-repudiation authority** (E-19). Its key, and every rotation of it,
  are public too (E-20).
- **The whole spend graph on `Zeto_Anon` and `Zeto_AnonEnc`.** Only the nullifier variants
  mask it (P-6).

The walkthrough's own list of what is not hidden and what is not demonstrated is in
[`example/README.md`](example/README.md#what-is-not-hidden).

## Getting started

Read the walkthrough before running it. [`example/run.ts`](example/run.ts) is numbered by
section, and every section ends in assertions: the run exits 1 if any claim it tests turns out
false. The auditor walkthrough is [`example/run-auditor.ts`](example/run-auditor.ts).

**Prerequisites.** These versions are what this README was verified with, read by command on
2026-09-27 ([`RUNS-2026-09-27.md`](docs/step3/RUNS-2026-09-27.md) §1). Other versions were not
tested.

| For | Tool | Verified version |
|---|---|---|
| all paths | Node.js, npm | v22.23.2, 10.9.8 |
| all paths (the devnet) | Docker, kind, kubectl, helm | 29.8.0, 0.32.0, v1.30.7, v4.2.2 (Paladin's guide says helm v3; v4 worked) |
| installed by the charts | Besu (all paths), Paladin and Postgres (A, B) | 25.8.0, v1.0.0, 17.6 |
| Path C's fetch | bash, curl, `shasum`, `tar`, `mkfifo` | bash 3.2.57, curl 8.7.1 |
| the machine | Apple M3 Pro, 12 cores, 18 GB, macOS 26.6.2 | the only machine tested |

Path C needs only the Besu nodes, but they come from the same devnet install. It reads
`BESU_RPC` (default `http://localhost:31545`); pointing it at another gasPrice-0 chain was not
tested.

**Resources** (measured 2026-09-27, [`RUNS-2026-09-27.md`](docs/step3/RUNS-2026-09-27.md) §1):
- **Memory.** Give Docker about 12 GB. The Docker VM here had 11.7 GiB, and the devnet filled
  it (11,141 of 11,945 MiB used, swapping) before Path B started failing (E-21).
- **Disk.** The four devnet images are about 1.4 GB (Paladin 824 MB, Besu 319 MB, Postgres
  160 MB, operator 56 MB). `node_modules` is about 610 MB across the two packages, and
  `artifacts/` 50 MB: Path C's 1.27 GB download is streamed, not stored.
- **Time.** The devnet install time was not recorded. The paths themselves take seconds to
  minutes (below).
- **Don't overlap.** Run Path C's fetch on its own, not while Path B is running.

**The devnet.** Paths A and B need the local 3-node Paladin + 3-node Besu devnet, and Path C
needs its Besu nodes. These are Paladin's documented installation commands
([`paladin-trust.md` §5](docs/task-zero/sources/paladin-trust.md)), pinned to the v1.0.0 this
study uses:

```sh
curl -L -O https://raw.githubusercontent.com/LFDT-Paladin/paladin/v1.0.0/operator/paladin-kind.yaml
kind create cluster --name paladin --config paladin-kind.yaml
helm repo add paladin https://LFDT-Paladin.github.io/paladin --force-update
helm upgrade --install paladin-crds paladin/paladin-operator-crd --version 1.0.0
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager --namespace cert-manager --version v1.16.1 jetstack/cert-manager --create-namespace --set crds.enabled=true
helm upgrade --install paladin paladin/paladin-operator -n paladin --create-namespace --version 1.0.0
```

The devnet used here was installed on 2026-09-26 with the guide's unpinned commands. Those
resolved to exactly these versions: `helm list -A` shows `paladin-operator-crd-1.0.0`,
`paladin-operator-1.0.0` and `cert-manager-v1.16.1`, and the kind config at the v1.0.0 tag is
byte-identical to the one on `main` (blob `0bf07611…`). The pinned form above was not itself
re-run, because that would have recreated the running devnet.

The devnet is ready when:
- `kubectl -n paladin get pods` shows every pod Running;
- `kubectl -n paladin get scd` shows the deployments Succeeded;
- `kubectl -n paladin get reg` lists node1 to node3.

The Paladin nodes then answer on `localhost:31548`, `31648` and `31748`, and Besu on
`localhost:31545`.

Then install once from the repository root:

```sh
npm ci && npm --prefix tools/observer ci
```

### Path A — the observer only

This path runs one real transfer and records only what a full-chain observer can read from the
base ledger. Next to that, it records what the sending node privately holds. Gas is free on the
devnet (gasPrice 0), so no funds are involved.

```sh
npm --prefix tools/observer run observe
```

It took about 15 s on 2026-09-27 (E-21). It writes `tools/observer/observer-out.json`.
`TOKEN=Zeto_AnonEnc` observes the receiver-ciphertext variant instead. The fields to read are
listed under [Evidence](#evidence-a-stranger-can-check), and the options in
[`tools/observer/README.md`](tools/observer/README.md).

### Path B — the full walkthrough on the Paladin devnet

This path deploys fresh tokens, runs the double-spend control, three transfers on each of two
variants, the leak and linkability probes, and a reconciliation against an off-chain book.

```sh
npm run example
```

It took 1 min 25 s and passed every check on 2026-09-27, but the first three attempts failed
while the host was overloaded (E-21):
- If it stops at `Failed while waiting for receipt`, look for `Request cancelled` in the node
  logs (`kubectl -n paladin logs paladin-node1-0 -c paladin`). Under memory pressure Paladin can
  cancel the proof request after about 10 s and keep retrying; the transfer lands minutes later.
- `POLL_MS=600000` raises the walkthrough's wait (default 60 s).
- `kubectl -n paladin delete pod paladin-node1-0 paladin-node2-0 paladin-node3-0` restarts the
  nodes. Their state lives on persistent volumes and survives. That is what fixed it here.

What each attempt did, with the node log lines, is in
[`RUNS-2026-09-27.md`](docs/step3/RUNS-2026-09-27.md) §3.

The transcript goes to `example/out/run-latest.log` and the full record to `run-latest.json`.

### Path C — the non-repudiation auditor walkthrough

This path needs only the devnet's Besu node, not Paladin: Paladin v1.0.0 cannot drive this
variant (E-19).

```sh
npm run setup:auditor     # once: Zeto v0.2.2 contracts, circuit and UNSAFE test keys -> artifacts/
npm run example:auditor
```

`setup:auditor` streams **1.27 GB** of Zeto's UNSAFE test proving keys and writes only the two
files the circuit needs, into the git-ignored `artifacts/`. `artifacts/zeto-v0.2.2/MANIFEST.txt`
records the sha256 of everything it fetched. On 2026-09-27 the fetch took 1 min 30 s, and the
walkthrough took 2 min 30 s under load with 30 of 30 checks passing (E-21); in step 2's runs
it took about 40 s ([`AUDITOR-VARIANT-2026-09-27.md`](docs/step2/AUDITOR-VARIANT-2026-09-27.md)
§2). The walkthrough deploys the
variant behind a UUPS proxy and sets and rotates the authority key. It then prints what the
non-repudiation authority, a receiver and an observer can each decrypt.

## Comparison with XLS-96

This study is the EVM counterpart of a study of XRPL's XLS-96 confidential transfers. The
XLS-96 column below is that study's findings, not re-derived here. The full table is
[`COMPARISON-XLS96-2026-09-26.md`](docs/task-zero/COMPARISON-XLS96-2026-09-26.md).

| | Zeto on Paladin (this study) | XLS-96 (reference study) |
|---|---|---|
| Hides | amounts and owners, and in the nullifier variants the spend graph | amounts and balances |
| Public | submitter EOA, timing, gas, note count; deposit and withdraw amounts (E-22) | sender, receiver, timing; amounts entering and leaving confidential form |
| Trusted setup | Groth16, one ceremony per circuit, shipped as UNSAFE test keys (E-5) | none: Bulletproofs |
| Proof | 256 bytes, invariant (E-9) | larger, per transaction type |
| Where trust sits | the Paladin node holding keys and plaintext (E-8) | the issuer |

| Who can decrypt | |
|---|---|
| XLS-96 | the XLS-96 issuer sees every balance, and that view is mandatory |
| The non-repudiation variant | the non-repudiation authority sees every sender, receiver and amount, only if that variant is deployed (E-19) |
| The four Paladin devnet variants | no third party: only the Paladin node that holds the keys sees everything (P-5, E-8), and on `Zeto_AnonEnc` a receiver sees its own note (next row) |
| `Zeto_AnonEnc`, one of those four | only the receiver, from the ciphertext it puts on chain for its own note (E-7) |

The two are near-duals. XLS-96 leaves the graph public, forces an issuer view and needs no
ceremony. Zeto's nullifier variants hide the graph (`Zeto_Anon` and `Zeto_AnonEnc` do not),
no Zeto variant gives a view by default, and every circuit needs a ceremony.

**Proving time** on the Apple M3 Pro under load (snarkjs 0.7.5, 20 runs, every proof verified):
`anon` median 326 ms and `anon_enc` 851 ms (E-9). Nullifier-variant proving time is not
measured (GAP-2, B-2 pending).

**Gas** on Besu QBFT at gasPrice 0 (E-10), quoted as the ranges observed across archived runs.
Nullifier-family gas depends on the data, so no single figure applies:
- `Zeto_AnonNullifier` transfer: 1.38 M–2.31 M over thirteen transfers.
- Non-repudiation transfer: 1.58 M–2.25 M over six transfers.
- `Zeto_AnonEnc` transfer: 412,957–412,975.
- `Zeto_Anon` transfer: 321,643–330,950.

## Open gaps

Named gaps are a correct output. They are kept, not backfilled. The full list with how to close
each is [`GAPS-2026-09-26.md`](docs/task-zero/GAPS-2026-09-26.md):

- **GAP-1, closed for non-repudiation** (E-19, E-20). Its qurrency half is GAP-7.
- **GAP-2:** nullifier-variant proving time, including the non-repudiation circuit, is not
  measured (B-2, pending).
- **GAP-3:** Zeto's hardhat gas suite does not run against the release artifacts. Gas was
  measured on the live chain instead.
- **GAP-4:** the drift between the pinned Zeto v0.2.2 and Zeto HEAD is not fully mapped.
- **GAP-5:** private or unpublished audits cannot be excluded by a public search.
- **GAP-6:** end-to-end transfer latency, from submission to receipt, is not measured (B-1,
  pending). E-21 records a failure mode under load, not a latency.
- **GAP-7:** the qurrency authority cannot be executed at the pin. Its circuit has no authority
  envelope at v0.2.2. Its related finding (F-3) is withheld pending coordinated disclosure.

Findings F-1 and F-3..F-6 are in [`CLAIMS.md`](CLAIMS.md#findings--file-upstream-before-publishing).
As of 2026-09-27 none has been filed upstream. Each will be reviewed by the repository owner
before it is filed.

## The gates

`npm run check` runs four steps:

| Gate | Command | What fails it |
|---|---|---|
| Types | `npm run typecheck` | a type error in `tools/` or `example/` (`tsc --noEmit`, strict) |
| Disclosure | `npm run check:disclosure` | a sentence that claims more than `CLAIMS.md` supports; a citation of a row id missing from the register; a pending row cited as support; a missing required section; any rule whose own controls stop passing (E-18) |
| Tests | `npm test` | the probe and envelope unit tests (each fails on a fixture where its claim is false), and the gate's subprocess tests (the gate must fail on each injected overclaim and missing section) |
| Counts | `npm run check:counts` | the [By the numbers](#by-the-numbers) block no longer matches what `tools/counts.ts` derives |

None of them needs the devnet. The walkthroughs are the executed evidence, and they carry their
own assertions.

## Layout

```text
README.md                  this file
LICENSE, NOTICE            Apache-2.0, and what is third-party
CLAIMS.md                  the claims register: P- prohibitions, E- evidence, B- pending, F- findings
docs/
  ROADMAP.md               the plan after Task Zero, with the build order
  task-zero/               Task Zero: answers, XLS-96 comparison, gaps list, primary-source notes
  step2/                   the non-repudiation variant: why standalone, what ran, what it showed
  step3/                   the getting-started re-run record and its evidence
example/
  run.ts                   the Paladin walkthrough, sections 0-6
  run-auditor.ts           the non-repudiation walkthrough, sections 0-8
  src/                     the library both walkthroughs use (Paladin client, chain reads, probes, verdicts)
  tests/                   unit tests for the probes and verdicts
  out/                     the latest and the dated archived runs (transcripts and JSON records)
tools/
  check-disclosure.ts      the disclosure gate, with its per-rule controls
  check-disclosure.test.ts the gate's subprocess tests
  counts.ts                derives the counts in this README
  fetch-zeto-v0.2.2.sh     Path C's fetch (npm run setup:auditor)
  observer/                the Task Zero observer harness and proof benchmark (its own package)
artifacts/                 git-ignored: the fetched Zeto v0.2.2 contracts, circuit and keys
```

## By the numbers

Generated by [`tools/counts.ts`](tools/counts.ts); `npm run check` fails when the block is
stale, so no count in this README is typed by hand.

<!-- counts:begin — generated by `npm run counts`; `npm run check` fails if stale. Do not edit by hand. -->

| What | Count | Derived from |
|---|---|---|
| Files in the repository | 82 (top level 8, docs/ 16, example/ 36, tools/ 22) | `git ls-files --cached --others --exclude-standard` |
| Files the disclosure gate scans | 31 | the gate's own scope list |
| Disclosure-gate rules | 25, enforcing 12 prohibitions (P-1..P-12) and containing 1 finding held for private disclosure | `RULES` in `tools/check-disclosure.ts` |
| Gate controls | 42 bad and 34 good samples, run through the real detector on every scan | the same `RULES` |
| Required disclosures | 9 | `REQUIRED` in the same file |
| Tests | 58, all passing | `npm test`, read from the runner's summary |
| Checks in `example/out/auditor-2026-09-27a.json` | 30/30 passed | its `checks[]` |
| Checks in `example/out/auditor-2026-09-27b.json` | 30/30 passed | its `checks[]` |
| Checks in `example/out/auditor-2026-09-27c.json` | 30/30 passed | its `checks[]` |
| Checks in `example/out/run-2026-09-27a.json` | 35/35 passed | its `checks[]` |
| Checks in `example/out/run-2026-09-27b.json` | 35/35 passed | its `checks[]` |
| Checks in `example/out/run-2026-09-27c.json` | 35/35 passed | its `checks[]` |
| CLAIMS rows | 43: 12 prohibitions (P-1..P-12), 22 established (E-1..E-22), 2 pending (B-1, B-2), 1 resolved (B-3), 6 findings (F-1..F-6), 0 retracted | `CLAIMS.md` |
| Gaps | 7: 6 open (GAP-2, GAP-3, GAP-4, GAP-5, GAP-6, GAP-7), 1 closed (GAP-1) | `docs/task-zero/GAPS-2026-09-26.md` |

<!-- counts:end -->

## Licence

Apache License 2.0: see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). This is the same
licence as Paladin (including its Noto domain) and Zeto (E-1, re-checked 2026-09-27). The Zeto
v0.2.2 contract ABIs in [`tools/observer/abi/`](tools/observer/abi/) are Zeto's own, under its
Apache-2.0 licence.

## Credit

- Zeto and Paladin are the work of their maintainers, now under LF Decentralized Trust
  (`LFDT-Paladin`).
- The UNSAFE-keys finding is Zeto's own: its README calls the keys UNSAFE, and issue #186 was
  raised by its reporter.
- The qurrency design is from its authors' ePrint 2026/015.
- Where this study analyses their published work, the analysis is not original research (P-12).
- The method is carried over from the XLS-96 reference study: execution over reading, a claims
  register, a disclosure gate, and named gaps.
