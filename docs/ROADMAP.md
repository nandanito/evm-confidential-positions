# Roadmap — after Task Zero

> **A planning document, kept as written with status notes added.** For what was actually
> built and what it shows, read the [README](../README.md). Some plans below changed in the
> building: deposit/withdraw were never run (E-22 is from source), the gates are `npm run`
> scripts rather than `make check-*`, and the devnet commands are in the README, pinned.
> "Zeto hides … counterparties" below means the owner keys and, in the nullifier variants, the
> spend graph; the submitter EOA stays public (P-4).

Planning document. **Step 1 (disclosure gate + example skeleton) was built on 2026-09-27** —
see `example/README.md` and `CLAIMS.md` E-14..E-18. **Step 2 (close GAP-1) was built the same
day**: see `docs/step2/AUDITOR-VARIANT-2026-09-27.md` and `CLAIMS.md` E-19, E-20. **Step 3 (the
README rebuild) was built the same day**: `README.md`, with its getting-started paths re-run in
`docs/step3/RUNS-2026-09-27.md` (E-21). The rest is not started. It turns the Task Zero findings
(`docs/task-zero/`) into a concrete next phase, modelled on the reference project
`xrpl-confidential-positions` but adapted to what Zeto is (hides amounts **and**
counterparties; UTXO; per-circuit Groth16 trusted setup; the Paladin node is the trust
boundary). Dates are absolute; this doc was written 2026-09-26.

The four pieces the user asked to plan:
1. [The worked example](#1-the-worked-example) — what to build, learned from the reference.
2. [Recommendations, with justification](#2-recommendations-if-i-were-to-choose) — the choices to make.
3. [README rebuild](#3-readme-rebuild) — mirror the reference's shape, add a getting-started.
4. [Vercel-hosted UI](#4-vercel-hosted-ui) — architecture, framework, and the hosting constraint.

---

## 1. The worked example

**What the reference did (and why it works).** Its example is a *confidential
receivables-financing facility*: a bank opens a facility, suppliers A/B/C draw down and repay,
amounts and balances are hidden but counterparties/timing/tranches are public, and the XLS-96 issuer
can decrypt every balance. It is effective as evidence — not a happy-path demo — because it:
- **executes the failure mode**, not just the success (it runs the `tapFailHard` control in both
  arms to prove a failed confidential tx leaks ciphertext);
- ships an **independent observer harness** plus pasteable on-ledger hashes so a stranger can
  verify what is hidden without trusting the repo;
- **measures the leak surface** (every public field) and states each as a graded CLAIMS row;
- **names what it does NOT demonstrate** (single-host custody, no permissioned domain).

**The Zeto analog to build.** Zeto hides more than XLS-96 (the counterparty graph too), so the
example should demonstrate *that extra* and be equally honest about the new boundaries. Proposed
scenario, mirroring the reference's shape:

> **A confidential inter-desk position transfer.** An issuer (central desk) mints private
> positions to two or more trading desks; desks transfer positions between each other; a
> reconciliation/observer step shows that on chain you see only commitments, nullifiers, a
> proof, and the (per-epoch) submitter EOA — **not** who paid whom, nor how much.

Build it as (mirroring `facility/`):
- **`example/` (TypeScript library + one executable walkthrough)** driving real transactions on
  a live chain, in numbered sections: (0) chain/source, (1) an **adversarial control**, (2)
  deploy + mint, (3) confidential transfer (amount+parties hidden), (4) the boundary leaks made
  explicit, (5) reconciliation, (6) the observer view. Reuse `tools/observer/observe.ts` — it is
  already the section-6 observer harness.
- **The three adversarial arms** (the equivalent of the reference's `tapFailHard` both-arms test):
  1. **Nullifier reuse / double-spend** attempt that MUST be rejected on chain (proves anti-replay).
  2. **Linkability probe**: two transfers to the same desk are shown to be unlinkable on chain
     in the nullifier variant (and *linkable* in plain `Zeto_Anon`, to show the difference).
  3. **Boundary leaks** run on purpose: `deposit`/`withdraw` reveal amount + the caller EOA;
     every transfer reveals the submitter EOA (indexed) and the note count via padding; and, in
     an auditor variant, the authority can still decrypt everything.
- **A disclosure gate** (like the reference's `check-disclosure-phrases.ts`): a test that fails
  if any README/UI sentence claims more privacy than CLAIMS.md supports. This is the single most
  valuable thing to port — it is what keeps the demo honest.
- **An honest "what is NOT hidden / NOT demonstrated" section**: submitter EOA, note count,
  timing, gas; mint/withdraw plaintext; the **UNSAFE test keys** (no real soundness); single-node
  key custody; anonymity-set size = the SMT contents.

**What NOT to copy:** the reference's Rust signer-over-Unix-socket is XRPL/secp256k1-specific and
solves a custody-separation problem we do not have the same way — Paladin already holds the keys
and proves in-node. For a standalone (non-Paladin) example, a thin TS signer using Zeto's
`zkp/js` is enough. Decide per the deployment target (§2).

---

## 2. Recommendations, if I were to choose

Each is a recommendation **with the reason and the trade-off**, so the choice stays yours.

### A. Which Zeto variant to build on — **recommend `Zeto_AnonNullifier` as primary**
- **Why:** it hides amount, owner identity, *and* the input→output link (history masking), and
  exposes no plaintext to any third party — the cleanest demonstration of Zeto's differentiator
  over XLS-96. It is also one of the 4 variants the Paladin devnet actually deploys and that we
  executed in Task Zero (`CLAIMS.md E-6`).
- **Pair with `Zeto_AnonEnc`** as a teaching foil: it puts receiver-decryptable ciphertext on
  chain, so the demo can show "the receiver decrypts, the observer cannot," and its proving
  assets are light enough for the browser (§4).
- **Trade-offs / alternatives:** plain `Zeto_Anon` leaks the whole UTXO graph — use it only as
  the "before" in the linkability probe, never as the headline. The NF variants are NFTs, not
  fungible positions. If a **regulator view** is required, add
  `Zeto_AnonEncNullifierNonRepudiation` — but note it is **not** on the Paladin devnet (GAP-1)
  and its authority key is **owner-rotatable with no timelock** (`CLAIMS.md E-4, P-7`), which is
  itself a trust fact to disclose. *(Step 2, 2026-09-27: executed standalone on Zeto v0.2.2, E-19
  and E-20. Paladin v1.0.0 cannot drive it, and the non-repudiation authority also links every
  nullifier spend to the note it consumed.)* If **membership gating** is required, `Zeto_AnonNullifierKyc`
  (owner-controlled registry, no revoke).

### B. Trusted setup — **recommend: stay a study on the shipped test keys, labelled UNSAFE; do NOT run a ceremony yet**
- **Why:** the demo's value is honesty, not security theatre. The δ=γ test-key weakness is
  already public (Zeto #186) and recorded (`CLAIMS.md E-5, P-2`). A real per-circuit Groth16
  phase-2 ceremony is a multi-party effort not justified for a testbed.
- **Guardrail:** the disclosure gate (§1) must make "UNSAFE keys / not for value" unmissable.
- **If the project ever targets value:** scope a per-circuit ceremony (snarkjs `zkey contribute`
  + a public beacon) as its own task. That is the one thing a value-bearing Zeto deployment needs,
  and it is absent by default.

### C. Where the chain and the Paladin node live — **recommend a two-tier split**
- **Tier 1 (hosted, always-on): a Zeto-direct demo on a public EVM testnet.** Deploy the Zeto
  contracts to Sepolia (or a Kaleido/besu testnet), prove client- or server-side, submit with a
  burner key. Needs no babysat node. This is what a Vercel URL can realistically serve 24/7.
- **Tier 2 (local, faithful): the full Paladin+Zeto multi-node run**, documented as "run it
  yourself" (the Task Zero devnet), **not hosted**. Paladin cannot run on Vercel (it is a stateful
  node with a DB and an in-process prover), and a hosted node that custodies keys is a liability.
- **Why this split:** it mirrors the reference repo, which **deliberately never deployed its UI**
  and bound it to `127.0.0.1` precisely because a hosted app touching keys/submission is a custody
  risk. We keep the honest, always-on part public and the key-touching part local.

### D. Web framework — **recommend Next.js (App Router) on Vercel; Vite+React if purely client-side**
- **Next.js App Router** if you want serverless API routes — to proxy an RPC, serve proving
  assets, or run server-side proving for the heavy nullifier circuit. Best-in-class Vercel
  deploy. **This is the default recommendation.**
- **Vite + React** if the UI is purely client-side (observer view + client proving for the light
  variants): simplest, deploys to Vercel as a static site, zero server.
- **TanStack Start** is what the reference used; fine, and worth it if cross-project consistency
  matters, but newer and a slightly less proven Vercel story than Next.
- Either way: Tailwind for styling (both projects already lean that way).

### E. Proving location — **recommend browser for `Anon`/`AnonEnc`, server/Paladin for nullifier**
- Measured asset sizes: `anon` zkey 3.4 MB + wasm 2.0 MB; `anon_enc` 10 MB + 2.2 MB — **browser
  proving is feasible** (one-time cached). `anon_nullifier_transfer` zkey is **37 MB** and needs
  live SMT state — impractical in-browser; do it **server-side** (a small proving function/
  service) or via a local Paladin node.
- **Consequence for the plan:** the always-on Vercel tier naturally demos the *lighter* variants
  in-browser; the *higher-privacy* nullifier variant belongs to the server/Paladin tier. Say this
  out loud in the UI — it is itself an honest finding about the cost of the stronger privacy.

---

## 3. README rebuild

Port the reference README's shape (it is excellent) to this project. Proposed outline:
1. **Title + one-paragraph plain-English scenario** ("An issuer mints private positions; desks
   transfer them; on chain you see neither who nor how much…").
2. **The blunt honest answer** immediately after ("Zeto hides amounts and the counterparty graph
   in the nullifier variants — but the submitter address, timing, note count, and mint/withdraw
   amounts are public, and the shipped keys are UNSAFE test keys").
3. **Status** — measured, dated, links to `TASK-ZERO-2026-09-26.md`.
4. **Evidence a stranger can check** — the observer-harness output + (once on a public testnet)
   pasteable tx hashes to view on Etherscan.
5. **How it fits together** — a small ASCII/diagram: prover → Zeto contract → base ledger; and
   the Paladin-node variant.
6. **Trust model** — the node, the contract owner, the (optional) authority; link `CLAIMS.md`.
7. **So what is confidential** / **What is NOT hidden**.
8. **Getting started** (see below).
9. **The gates** (`make check-*`), **Layout**, **Comparison vs XLS-96**, **Open questions/gaps**,
   **Licence**, **Credit**.

**Getting-started example to include** (prose-first, like the reference — not copy-paste-happy):
- Prerequisites (Docker, kind, kubectl, helm, Node, and the Zeto artifacts).
- "Read the walkthrough first" → link `example/run.ts`.
- **Path A — observer only (no funds):** `npm run observe` against the local devnet (already
  works today via `tools/observer`).
- **Path B — full local devnet:** the four `helm`/`kind` commands from `TASK-ZERO §1`, then the
  example walkthrough.
- Follow with "The gates" and a layout tree. Use `grep`-derived counts, never hardcoded numbers
  (the reference's recurring self-documented defect).

---

## 4. Vercel-hosted UI

**The hard constraint, stated first:** Vercel hosts a **frontend + serverless functions**, not a
blockchain and not a Paladin node. So a hosted UI must talk to a chain/node that lives elsewhere.
That gives two shapes; recommend shipping the first and documenting the second.

**Shape 1 (recommended for Vercel) — "Observer + client-proving" on a public testnet.**
- Frontend on Vercel. Zeto contracts pre-deployed to Sepolia (Tier 1, §2C).
- The UI does the light-variant (`Anon`/`AnonEnc`) proof **in the browser** with `zkp/js` +
  snarkjs (assets served statically), submits with a user-supplied **burner testnet key**
  (never a real key — enforced and stated).
- The centrepiece screen is the **observer view**: paste/produce a transfer, then show side by
  side "what a full-chain observer sees" vs "what stays hidden," reusing the Task Zero harness
  logic. This is the honest, always-on demo and needs no server state.
- Optional serverless route for the **nullifier variant**: server-side proving (37 MB zkey) —
  but note Vercel function size/time limits; a tiny dedicated proving service (Fly/Render) may be
  cleaner. Flag as a stretch goal.

**Shape 2 (documented, not hosted) — the faithful Paladin path.**
- The frontend can point at a **user's own Paladin JSON-RPC** (localhost or their cluster). We do
  not host the node or its keys. This mirrors the reference's read-only, localhost-bound UI.

**What the UI should show (screens):**
- Overview + the capability matrix (which variant hides what).
- **Observer view** (the star): hidden vs. public fields for a real transfer.
- A "run a confidential transfer" flow for `Anon`/`AnonEnc` (client-proving).
- An "auditor view" demo *only* if the non-repudiation variant is deployed (GAP-1) — showing the
  authority decrypting, and stating the owner-rotatable-key caveat. **Decided 2026-09-27 (step 2):
  the screen exists, in Shape 1 only.** It is the standalone Zeto deployment, not the Paladin
  path, which cannot drive the variant. The non-repudiation authority sees sender, receivers,
  amounts and which note each nullifier spent (E-19). The screen must also state that the owner
  can rotate the key at any time with no event or delay, and can upgrade the contract (E-20).
- A disclosure footer that the disclosure gate (§1) checks.

**Recommended stack for Vercel:** Next.js (App Router) + Tailwind + `viem`/`ethers` for chain
calls + `snarkjs`/`zeto-js` for client proving. Keep proving assets in `public/` or on a CDN;
lazy-load them so the page is fast until the user actually proves.

**Honesty guardrails carried from the reference:** never custody a real key in a hosted app;
label the testnet + UNSAFE-keys status on every screen; the disclosure gate runs in CI; and the
observer view must show the *leaks* (submitter EOA, note count, timing), not just the hidden
fields — otherwise it is the happy-path demo this project exists to avoid.

---

## Suggested sequencing (when it is time to build)

1. **Disclosure gate + honest example skeleton** (`example/run.ts` sections, reusing the observer
   harness). Small, high-value, keeps everything else honest.
2. **Close GAP-1** (deploy + run an auditor variant) — decides whether the "auditor view" screen
   exists. **Built 2026-09-27:** the non-repudiation variant, standalone; the screen exists in Shape 1
   only (`docs/step2/AUDITOR-VARIANT-2026-09-27.md`).
3. **README rebuild** (§3) once the example runs end to end. **Built 2026-09-27:** all three
   getting-started paths executed from `npm ci` (Path B needed a Paladin pod restart under host
   load, E-21); counts are generated by `tools/counts.ts` and checked by `npm run check`.
4. **Vercel Shape 1** (observer + client-proving on Sepolia).
5. **(If value ever matters) the trusted-setup ceremony** — its own task, gated behind a real decision.

Steps 1, 2 and 3 are built (2026-09-27). The rest is not started.
