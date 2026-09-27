# Step 2 — the auditor variant, executed (closes GAP-1 for non-repudiation)

Date: 2026-09-27. Roadmap step 2 (`docs/ROADMAP.md`, sequencing list): deploy and run an auditor
(designated-decryptor) variant, then decide from the evidence whether the non-repudiation "auditor view" exists
for this project. Grades and row ids are `CLAIMS.md`'s.

> **A study on a local devnet, not for value.** The Groth16 keys are Zeto v0.2.2's shipped
> **UNSAFE** test keys (no phase-2 contribution, δ=γ; E-5, P-2). The non-repudiation run below
> holds every desk's and every authority's Baby Jubjub key in one process. No public audit of
> either project was found in the searched corpus (E-11).

**Answer.** Yes, with conditions. The view exists **only** in a standalone deployment of
`Zeto_AnonEncNullifierNonRepudiation` (Zeto v0.2.2 contracts, client-side proving), and
**not** on the Paladin path: Paladin v1.0.0 cannot drive the variant (§1). Where it exists, the
non-repudiation authority sees the full sender + receivers + amounts tuple of every transfer
**and** can name the note each nullifier spent. The owner can swap the authority key at any time
with no event and no delay, and can upgrade the contract (§3). The four stock devnet variants
still give no third party a view (P-5).

---

## 1. Deployment path — decided by running the checks

**Option 1 — Paladin v1.0.0's Zeto domain: does not work on the pinned stack.** (Not to be confused with the README's getting-started Paths A–C.) Checks run 2026-09-27
against the Task Zero devnet (`lfdecentralizedtrust/paladin:v1.0.0`, Besu 25.8.0) and the Paladin
clone at tag `v1.0.0` (`6d4b913`):

| Check | Command | Result |
|---|---|---|
| Domain config | `kubectl -n paladin get paladindomain zeto -o jsonpath='{.spec.configJSON}'`; `git show v1.0.0:operator/config/samples/core_v1alpha1_paladindomain_zeto.yaml` | 4 implementations only: `Zeto_Anon`, `Zeto_AnonEnc`, `Zeto_AnonNullifier`, `Zeto_AnonNullifierKyc`. No non-repudiation entry. The circuit flags are `usesNullifiers`, `usesEncryption` and `usesKyc`; there is no authority flag (`zetosignerapi/config.go:45-47`) |
| Shipped circuits and keys | `kubectl -n paladin exec paladin-node1-0 -c paladin -- ls /app/domains/zeto/zkp` | 39 entries, none matching `repud` or `qurr` (grep exit 1) |
| Domain code | `git grep -n -i -E "non_?repudiation\|NonRepudiation\|arbiter\|authorityPublicKey\|qurrency" v1.0.0 -- domains/zeto operator sdk/typescript` | **0 hits.** The prover cannot build the authority inputs (`authorityPublicKey`) or read the arbiter |
| Factory registration | `kubectl -n paladin get smartcontractdeployments` | 4 `zeto-impl-*` implementations registered (anon, anon-enc, anon-nullifier, anon-nullifier-kyc) |

The first two rows could be patched: add a config entry, then mount the circuit and key. The
third row cannot be patched without **forking Paladin's Zeto domain**, so Option 1 is out on the
pin.

**Option 2 — standalone: taken.** The run deploys Zeto v0.2.2's release contracts to the same Besu
node and proves client-side:
- Contracts: release asset `zeto-contracts-v0.2.2.tar.gz`, compiled Hardhat artifacts.
- Proving: snarkjs 0.7.5, with Zeto's `zkp/js` taken from the v0.2.2 source tarball. The
  tarball's embedded commit, `5539a36`, is checked.
- Circuit: the `anon_enc_nullifier_non_repudiation` wasm, zkey and vkey from the v0.2.2
  release, streamed out of the 1.27 GB `zeto-test-proving-keys-v0.2.2.tar.gz`.
- Fetch: `npm run setup:auditor` (`tools/fetch-zeto-v0.2.2.sh`) downloads everything into the
  git-ignored `artifacts/`, and `artifacts/zeto-v0.2.2/MANIFEST.txt` records every sha256.
- The keys tarball hashed to `97808b3c…4ade0` on each of three downloads.

Library versions are exact pins in `package.json`:
- `maci-crypto` 1.1.1 and `@iden3/js-merkletree` 1.5.1: the versions Zeto v0.2.2's
  `solidity/package-lock.json` resolves.
- `@openzeppelin/contracts` 5.4.0: the UUPS `ERC1967Proxy`, the same version.
- `poseidon-lite` 0.3.0 and `circomlibjs` 0.1.7.

The deployment mirrors Zeto's own `scripts/deploy_upgradeable.ts` and
`scripts/tokens/Zeto_AnonEncNullifierNonRepudiation.ts` at v0.2.2:
- Poseidon libraries (from circomlibjs), `SmtLib`, and five verifiers;
- the implementation, linked to those libraries;
- an `ERC1967Proxy` whose `initialize` gets zero lock and burn verifiers.

**Qurrency (optional): not run.** At the pin it has nothing to observe. The v0.2.2
`Zeto_AnonNullifierQurrency` circuit has no authority envelope: `kyber_enc` outputs only a
SHA-256 hash, with a `// TODO: kyber encryption constraints`, and the contract emits no
ciphertext (`zeto-variants.md §7`). The ML-KEM envelope exists only at Zeto HEAD, which is off
the pin (P-3). Recorded as **GAP-7**. F-3 (a qurrency auditability finding) is withheld pending coordinated disclosure.

## 2. What ran

`example/run-auditor.ts` (`npm run example:auditor`, ~40 s here; 2 min 30 s under host load on the step 3 re-run, E-21). Archived runs:
- **a:** `example/out/auditor-2026-09-27a.{log,json}`, before the Codex review;
- **b:** `example/out/auditor-2026-09-27b.{log,json}`, after it.
- **c:** `example/out/auditor-2026-09-27c.{log,json}`, the step 3 re-run for the README (30/30, E-21).

Every section ends in assertions. Runs a and b each passed 30/30; the verdict functions have unit tests
that fail on false fixtures (`example/tests/envelopes.test.ts`). The run:
1. Deploys the variant behind a UUPS proxy owned by an issuer EOA.
2. Sets arbiter K1 and mints 100,000 to desk A as two notes.
3. **T1:** desk A → desk B 1,000, spending both notes (proven for K1).
4. Desk B proves **T2** (B → A 600) for K1. The owner then rotates to K2, and that K1 proof is
   simulated against the rotated contract.
5. Desk B re-proves T2 for K2 and submits it.

Run a's transactions (Besu chainId 1337):

| Step | Tx | Block | Logs | Gas |
|---|---|---|---|---|
| `setArbiter(K1)` | `0xa531e9e1…bfa8b6` | 5437 | 0 | 74,343 |
| mint (2 notes) | `0xb2e52663…9327e` | 5438 | 1 | 910,660 |
| T1 (2 in, 2 out; K1) | `0xa4e05d04…277dbb` | 5439 | 1 | 1,875,081 |
| `setArbiter(K2)` | `0x8f0d737c…b8b44c` | 5440 | 0 | — |
| T2 (1 in, 2 out; K2) | `0x7baa67a1…dcc7ce` | 5441 | 1 | 2,247,032 |

## 3. Results

**The three views (E-19).** For both T1 and T2:

| Who | Holds | Decrypts | Checked against |
|---|---|---|---|
| Non-repudiation authority | the arbiter key current when the transfer was proven | **14 fields** from the 16-element envelope: the sender's Baby Jubjub key, (value, salt) of both inputs, both output owners' keys, and (value, salt) of both outputs | The plaintext equals the prover's witness field for field. Each output hashes to its on-chain commitment. Each **real input hashes to a commitment an earlier transaction put on chain**, so the authority can name the note each nullifier spent: nullifier history masking does not hold against it |
| Receiver | its own key | **2 fields**, (value, salt) of its own output | They hash to its commitment and equal the authority's fields for that slot. Its key opens neither the authority envelope nor the other output's slot, so its view is a strict subset (F-4(b), now executed) |
| Full-chain observer | no key | **nothing** | 9 decryption attempts per transfer with fresh keys all fail. No value, salt or desk key appears as a plain 32-byte word in calldata, log data or topics. A detector control finds K2 in the rotation calldata, so the search is not blind. It does see the submitter EOA (indexed), note count, timing, gas, nonce, ECDH ephemeral key and 24 ciphertext elements |

**The trust facts about the authority key (E-20), executed on a contract we own:**
- **Unset at deploy.** `getArbiter()` is (0, 0) until the owner calls `setArbiter`. It is not
  an `initialize` argument.
- **No event.** Both `setArbiter` receipts have **0 logs**, and the token emitted 0 logs in the
  rotation block. The v0.2.2 ABI has no arbiter event at all (11 events, none about the
  arbiter).
- **No timelock.** `getArbiter()` returns K1 at block N−1 and K2 at the rotation's own block
  N. A transfer honestly proven for K1 before the rotation is rejected after it (`Invalid
  proof`, simulated), so the key is read from storage at verify time. T2, proven for K2,
  lands in the next block.
- **But not invisible.** The rotation is an ordinary transaction whose calldata carries the new
  key in the clear, sent from the owner's EOA. An observer that reads transactions, not only
  logs, sees who rotated, when, and to which key. A rotation made through an intermediate
  contract would show only in traces (not tested).
- **Old envelopes stay with the old key.** K1 opens T1 and not T2; K2 opens T2 and not T1. A
  rotated-out authority keeps everything it could already read.
- **Owner-only.** `setArbiter` from a non-owner reverts `OwnableUnauthorizedAccount`
  (simulated).
- **Upgradeable.** The proxy's EIP-1967 slot points at the implementation (UUPS). An owner
  upgrade could change or remove the authority requirement. That is grade C: no upgrade was
  run.

**Gas (E-10 method).**
- The NR transfer is a nullifier-family transfer, so its gas is data-dependent (SMT insert
  depth).
- Run a: T1 **1,875,081**, T2 **2,247,032**. Run b: T1 **1,582,038**, T2 **2,007,616**. Observed
  range over the four: **1,582,038–2,247,032**.
- The two-note mint is data-dependent too: 910,660 in run a, 1,077,226 in run b.
- Quote the observed range across archived runs, never one figure.
- NR proving time was **not measured**: GAP-2 and B-2 cover all nullifier-variant proving.

## 4. What this does NOT demonstrate

- **Paladin integration.** Paladin v1.0.0 cannot run the variant (§1). The non-repudiation auditor view here
  is a standalone-Zeto result, in the roadmap's Tier-1 shape.
- **Custody separation.** One process holds the desks' and the authorities' keys. Nothing
  here shows how an authority key would be generated, held or rotated in practice.
- **An upgrade** that removes the authority (C, above).
- **Rotation through a contract, multiple rotations, or races.** The stale-key rejection was
  simulated, not mined.
- **Deposit, withdraw, the 10×10 batch circuit, locks.** Not run.
- **Soundness.** The keys are UNSAFE (E-5, P-2). Every proof here is honest; no proof was
  forged or altered, and none will be.
- **Qurrency** (GAP-7) and its related finding (F-3, withheld pending coordinated disclosure).

## 5. What changes

- `CLAIMS.md`:
  - B-3 resolved: E-19 and E-20 for non-repudiation, GAP-7 for qurrency.
  - P-5 and P-7 now cite the executed rows.
  - F-4(b) executed.
  - E-10 carries the NR gas.
  - E-18 has the new gate controls.
- `docs/task-zero/GAPS-2026-09-26.md`: GAP-1 closed for non-repudiation; GAP-7 added.
- Disclosure gate: P-5 no longer excuses a sentence just because it names the
  non-repudiation variant. It is fail-closed: a sentence that attributes a decryption view must
  be about non-repudiation, qurrency or XLS-96 and must name no stock variant. Controls cover
  both directions (`tools/check-disclosure.ts`, `.test.ts`).
- `docs/ROADMAP.md`: the non-repudiation "auditor view" screen belongs to the standalone (Tier-1) shape only,
  with the rotation and custody caveats on screen.

## 6. Review

A native Codex review of the branch diff (`codex review --base main`, 2026-09-27) made three
findings, and all three were fixed:
- **P-5 false negative:** "only" counted as contrast.
- **P-5 false positive:** "the deployed nonrepudiation variant" was classed as a stock variant.
- **Missing evidence:** the cited run b was not yet archived.

Both P-5 sentences are now gate controls. Run b was produced after the fixes.

A targeted Codex round on the fix commit (`CODEX_ROUND=targeted:p5-allow-precedence-fix`, high
effort) found three more P-5 leaks, and each was confirmed by running `scanText`:
- a negation applied to the wrong subject;
- "unlike" applied to the wrong subject;
- a generic stock phrase excused because the same clause named non-repudiation.

It also found one false positive: "cannot" was not recognised as a negator. The rule is now
fail-closed rather than clause-parsing, and the three leaking sentences are bad controls. The
false positive stays by design: a mixed sentence has to be split in two. The same round found
the step's numbers consistent with run b's log.
