# One-page comparison: Paladin+Zeto vs XRPL XLS-96 — 2026-09-26

> **Updated 2026-09-27.** This is the Task Zero snapshot; the README's comparison is current.
> Since it was written: AnonNullifier gas is observed over thirteen transfers (still 1.38 M–2.31 M,
> E-10); the non-repudiation authority view was executed standalone (E-19, E-20); and two
> summary sentences below were narrowed. Zeto hides amounts and owner keys, and the nullifier
> variants also mask the spend graph, but the **submitter EOA is public** and groups a desk's
> transfers (P-4, E-16), and the sender's **Paladin node sees all plaintext** (E-8).

Same axes as the reference `xrpl-confidential-positions` study. Zeto facts are graded in
`TASK-ZERO-2026-09-26.md` / `CLAIMS.md`; XLS-96 facts are cited from the reference project's
`CLAIMS.md` (P-/E-rows) and `TASK-ZERO-2026-08-13.md` and are **that project's findings, not
re-derived here**. This is a structural comparison, not a benchmark race.

| Axis | **Paladin + Zeto** (this study) | **XRPL XLS-96** (reference study) |
|---|---|---|
| **Ledger model** | UTXO (commitments/nullifiers) on any EVM chain; runs as a Paladin private domain over Besu/L1/L2 | Account model, native XRPL L1 objects (MPT) |
| **What is hidden** | Transfer amount + owner (Baby Jubjub) identity inside a Poseidon commitment. Nullifier variants also mask the input→output graph | Amounts and balances only (ref P-4, P-11) |
| **What stays public** | **Submitter EOA (indexed)**, block time, gas, note counts (via zero padding), SMT root; deposit/withdraw amounts + caller EVM address; for AnonEnc the on-chain receiver ciphertext. Anon/AnonEnc: the whole UTXO graph | **Sender and receiver accounts, timing, frequency** — the counterparty graph is fully public (ref P-4, P-11) |
| **From whom (default deploy)** | From everyone: no third party gets plaintext in the 4 devnet variants. Counterparty (receiver) learns its own note value | From no one *except the issuer* — see below |
| **Who can decrypt (designated party)** | **Nobody by default.** Only if you deploy `…NonRepudiation` (ECDH+Poseidon) or `…Qurrency` (ML-KEM) does an *authority* see the full sender+receiver+amount tuple. Neither ships on the Paladin devnet | **The issuer, mandatorily.** The issuer shares its own ElGamal private key — holders are *never* private from the issuer (ref P-9). An optional separate auditor key exists |
| **Is the decryptor fixed / rotatable** | NR authority: set post-deploy by `setArbiter` (onlyOwner), **rotatable anytime, no event/timelock**, removable via UUPS upgrade. Qurrency: hard-coded in circuit, rotation = new ceremony + redeploy | Issuer mirror is **structural and mandatory**; XLS-96 supports **no key rotation and no key recovery** at any level (ref P-10) |
| **Trusted setup** | **Yes — Groth16, one ceremony per circuit.** Shipped keys are Zeto's **UNSAFE** test keys (δ=γ, no phase-2); Paladin deploys them unchanged. A real deployment must run its own ceremony | **None.** Twisted-ElGamal + compact sigma + **Bulletproofs** — transparent, no ceremony (ref E-3) |
| **Proof size** | **256 bytes, invariant** (Groth16/BN254) | 946 B fixed Send proof (192 B sigma + 754 B aggregated Bulletproof); larger, but no ceremony (ref E-3a) |
| **On-ledger payload / gas** | Executed: AnonNullifier transfer **1.38 M–2.31 M gas** (data-dependent SMT insert depth; thirteen transfers as of 2026-09-27, E-10), AnonEnc transfer **~412,960 gas** (±18 by calldata content) (Besu QBFT, gasPrice 0). Cost is EVM gas, chain-dependent | 1210 B (no auditor) / 1276 B (with) on the wire; 10× fee floor vs a standard tx (ref E-4, §6) |
| **Proving latency (M3 Pro)** | Executed: `anon` **326 ms**, `anon_enc` **851 ms** median over 20 runs, every proof verified (snarkjs; machine under load avg 12–15, so single proves vary ~2×). Nullifier proving: not measured (GAP-2) | Bulletproof (Send) proving **34.6 ms** / verify **16.1 ms** median; sigma adds ~0.2 ms (ref §6). Decryption ~2.5 s is the real cost |
| **Where proving happens / key custody** | In the sender's **Paladin node**, in-process, with the raw key; one mnemonic per node controls all keys; plaintext coin data in Postgres | Local proving preserves spending authority; issuer visibility is unchanged regardless (ref R-2) |
| **Trust boundary / worst-case compromise** | **The node.** A compromised node/operator/K8s-Secret reads all local users' balances+history and can spend all their funds. Multi-tenant, no isolation, devnet no auth | The issuer (mandatory decryption mirror) + XRPL validators. Named in the reference ADR-0001 |
| **Audited?** | No public audit found (2026-09-26 corpus). δ=γ test keys are disqualifying for value | Not audited / not production (ref P-5) |
| **Post-quantum** | Optional qurrency variant encrypts the auditor envelope with ML-KEM (the *rest* is still classical Groth16/BN254) | Application-layer PQ does not protect ledger-level funds (ref P-1, P-2) |

## The one-sentence contrast

**XLS-96 hides amounts but not counterparties and forces every holder to be transparent to the
issuer, with no trusted setup; Zeto hides amounts and owner keys, masks the spend graph in the
nullifier variants (the submitter EOA stays public), and exposes plaintext to no one beyond the
sender's own node by default, but pays for it with a per-circuit Groth16
trusted setup that currently ships as unsafe test keys, and concentrates all trust in the
Paladin node that holds the keys and the plaintext.**

## Implication for this project's plan

The two systems are near-duals: XLS-96 = transparent-graph + mandatory-issuer-view +
no-ceremony; Zeto = hidden-graph + no-default-view + mandatory-ceremony. The confidentiality a
"confidential positions" application actually needs — is it hiding *amounts*, *counterparties*,
or *both*, and who must retain a view — decides which system fits, and on the Zeto side it also
decides whether a trusted-setup ceremony is on the critical path. See
`TASK-ZERO-2026-09-26.md §8`.
