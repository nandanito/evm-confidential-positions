# Zeto token variants: primary-source notes

Repo: LFDT-Paladin/zeto, local clone `scratchpad/src/zeto`.
- HEAD = `dd495492f540c5f71988d15f8d3eb2b0d93c5099` (2026-09-17), latest tag v0.5.1.
- v0.2.2 = `5539a36487b004219a47642c2b32110df1b807db` (2026-01-12). Paladin pins this one.
- Paths below are relative to the repo root. "@HEAD" / "@v0.2.2" say which commit a line number refers to. "both" means the statement was checked at both commits.
- Grades: A = two primary sources agree (for example circuit + contract, or source + an executed check). B = one primary source. C = inference, stated as such. GAP = not established.
- 329 commits between v0.2.2 and HEAD. `git diff v0.2.2 HEAD --stat -- zkp/circuits solidity/contracts` gives 141 files, +16741/-14292. The Solidity layer was heavily refactored: ERC-7201 storage, Ownable2Step, a new lock model (ILockableCapability). The core circuit libraries did not change (see §0).

---

## 0. Circuit soundness finding — WITHHELD

**Withheld pending coordinated disclosure to Zeto/Paladin** (as of [not yet sent]). The full write-up is held privately until a fix ships or the embargo ends; the row is kept so numbering and links resolve. See `CLAIMS.md` row F-2.

## 1. Variant inventory at HEAD, mapped circuit → contract

Top-level circuits: `ls zkp/circuits/*.circom` @HEAD. Contracts: `ls solidity/contracts/*.sol`. The circuit → contract mapping comes from `solidity/ignition/modules/*.ts` (grep `Groth16Verifier_*`). Grade A: ignition module plus the verifier file names in `solidity/contracts/verifiers/`.

| Contract (HEAD) | Transfer circuit (2x2 / batch 10x10) | Lock circuit | Deposit / withdraw / burn | At v0.2.2? |
|---|---|---|---|---|
| Zeto_Anon (`zeto_anon.sol:44`) | anon / anon_batch | anon (same) | deposit / withdraw(_batch) | yes |
| Zeto_AnonBurnable (`zeto_anon_burnable.sol:50`) | anon | anon | + burn(_batch) | yes |
| Zeto_AnonEnc (`zeto_anon_enc.sol:43`) | anon_enc / anon_enc_batch | – | deposit/withdraw | yes |
| Zeto_AnonNullifier (`zeto_anon_nullifier.sol:35`) | anon_nullifier_transfer(_batch) | **anon / anon_batch** (the lock path spends raw commitments; `ignition/modules/zeto_anon_nullifier.ts:34-53` comment) | deposit / withdraw_nullifier(_batch) | yes (v0.2.2 used anon_nullifier_transferLocked) |
| Zeto_AnonNullifierBurnable | same | same | + burn_nullifier(_batch) | yes |
| Zeto_AnonEncNullifier (`zeto_anon_enc_nullifier.sol:35`) | anon_enc_nullifier(_batch) | – | deposit / withdraw_nullifier | yes |
| Zeto_AnonNullifierKyc (`zeto_anon_nullifier_kyc.sol:40`) | anon_nullifier_kyc_transfer(_batch) | anon_nullifier_kyc_transferLocked(_batch) | **deposit_kyc** (new) / withdraw_nullifier | yes (deposit was plain `deposit`) |
| Zeto_AnonEncNullifierKyc (`zeto_anon_enc_nullifier_kyc.sol:36`) | anon_enc_nullifier_kyc(_batch) | – | deposit_kyc / withdraw_nullifier | yes |
| Zeto_AnonEncNullifierNonRepudiation (`…non_repudiation.sol:37`) | anon_enc_nullifier_non_repudiation(_batch) | – | deposit / withdraw_nullifier | yes |
| Zeto_AnonNullifierQurrency (`zeto_anon_nullifier_qurrency.sol:46`) | anon_nullifier_qurrency_transfer(_batch) | ignition references `Groth16Verifier_AnonNullifierQurrencyTransferLocked` (`ignition/modules/zeto_anon_nullifier_qurrency.ts:38`), but no such verifier file exists at HEAD (C: stale module) | deposit / withdraw_nullifier | yes (prototype, see §7) |
| Zeto_NfAnon (`zeto_nf_anon.sol:36`) | nf_anon (1x1) | nf_anon | – | yes |
| Zeto_NfAnonNullifier (`zeto_nf_anon_nullifier.sol:50`) | nf_anon_nullifier_transfer (1x1) | – | – | yes |

- `check_nullifiers.circom` is a helper circuit with no token contract.
- **Removed since v0.2.2:** `anon_nullifier_transferLocked(_batch).circom`, `nf_anon_nullifier_transferLocked.circom`, `solidity/contracts/zkDvP.sol_` (inactive at v0.2.2).
- **Added since v0.2.2:** `deposit_kyc.circom`, `lib/deposit.circom`, `lib/kyc.circom`, `lib/pubkey.circom`, `lib/kyber/mlkem.circom`, `zkp/js/lib/testKeypair.js`.
- Source for both lists: `git ls-tree v0.2.2 zkp/circuits/` compared with a HEAD `ls`.

---

## 2. Public signals and events for fungible variants

Main lines are from `grep -n "component main"`, identical at both commits unless noted. Circom orders public signals as: outputs first, then public inputs in *declaration* order. The contract layouts match that order: NR `solidity/contracts/zeto_anon_enc_nullifier_non_repudiation.sol:125-134` against the NR base declarations at lines 35-52 (A).

| Variant | Public signals (main) | Circuit outputs (also public) | Event @HEAD |
|---|---|---|---|
| anon `anon.circom:20` | inputCommitments, outputCommitments | – | `UTXOTransfer(inputs, outputs, submitter, data)` (`lib/interfaces/IZeto.sol:35-39`, emitted `lib/zeto_fungible.sol:399`) |
| anon_enc `anon_enc.circom:20` | inputCommitments, outputCommitments, encryptionNonce | ecdhPublicKey[2], cipherTexts[nOut][4] | `UTXOTransferWithEncryptedValues(inputs, outputs, nonce, ecdhPublicKey, encryptedValues, submitter, data)` (`IZeto.sol:41-48`, `zeto_anon_enc.sol:78-86`) |
| anon_nullifier `anon_nullifier_transfer.circom:20` | nullifiers, outputCommitments, root, enabled | (inputOwnerPubKey is an output of the sub-template at HEAD, not of main) | `UTXOTransfer` |
| anon_enc_nullifier `anon_enc_nullifier.circom:20` | nullifiers, outputCommitments, encryptionNonce, root, enabled | ecdhPublicKey, cipherTexts | `UTXOTransferWithEncryptedValues` (`zeto_anon_enc_nullifier.sol:75-83`) |
| *_kyc `anon_nullifier_kyc_transfer.circom:20`, `anon_enc_nullifier_kyc.circom:20` | + utxosRoot, identitiesRoot | (enc: ecdh, cipherTexts) | same as the non-KYC parent |
| non-repudiation `anon_enc_nullifier_non_repudiation.circom:20` | nullifiers, outputCommitments, encryptionNonce, root, enabled, authorityPublicKey | ecdhPublicKey, cipherTexts, cipherTextAuthority | `UTXOTransferNonRepudiation(inputs, outputs, nonce, ecdhPublicKey, encryptedValuesForReceiver, encryptedValuesForAuthority, submitter, data)` (`…non_repudiation.sol:44-53,104-113`) |
| qurrency `anon_nullifier_qurrency_transfer.circom:20` | nullifiers, outputCommitments, root, enabled (encryptionNonce handling; see §7) | c[25] (ML-KEM ciphertext), cipherTextAuthority | `UTXOTransferWithMlkemEncryptedValues(inputs, outputs, nonce, encapsulatedSharedSecret, encryptedValues, submitter, data)` (`IZeto.sol:50-57`, `zeto_anon_nullifier_qurrency.sol:74-82`) |
| deposit `deposit.circom:20` (v0.2.2 `:47`) | outputCommitments; output `out` = sum of values (the amount) | – | `UTXOMint(outputs, submitter, data)`. `amount` is a plain function arg, and ERC20 `transferFrom(msg.sender)` (`lib/zeto_fungible.sol:264-310`) |
| withdraw / withdraw_nullifier `:20` | (nullifiers or inputCommitments), outputCommitments[1], (root, enabled); output `out` = amount | – | `UTXOWithdraw(amount, inputs, output, submitter, data)` (`zeto_fungible.sol:390`) |

**Derived visibility** (C, derived from the table above plus `lib/check-hashes.circom:37` commitment = Poseidon(value, salt, pkx, pky) and `lib/check-nullifiers.circom:42` nullifier = Poseidon(value, salt, privKey)).

- **Chain observer:**
  - Transfer amounts are hidden.
  - Owner public keys are hidden inside commitments.
  - Deposit and withdraw amounts are public, and so is the depositor's or withdrawer's EVM address (msg.sender). This links an EVM address to freshly minted commitments.
  - anon / anon_enc: the input commitments being spent are public, so the input-to-output UTXO graph is fully linkable. The docs say so too: `doc-site/docs/implementations/anon.md:16`, `anon_enc.md:17`.
  - Nullifier variants: the spent UTXO is hidden among all SMT leaves under `root`, so there is history masking. The number of inputs and outputs leaks through the zero padding: nullifier or output = 0, and enabled flags are public.
  - `submitter` (msg.sender) is always public and `indexed`.
- **Counterparty (receiver):**
  - Learns the value and salt of its outputs (off-chain for anon, via the ECDH ciphertext for enc).
  - The ciphertext uses an ephemeral key (`lib/encrypt-outputs.circom`: `Ecdh(ecdhPrivateKey, ownerPublicKey)`), so the sender's Baby Jubjub key is not revealed cryptographically (C).
- **Sender:**
  - In anon/anon_enc, can see when the receiver later spends the output, because the input commitment appears on chain (C).
  - In nullifier variants cannot, because the nullifier needs the receiver's private key (C).
- **Authority:** only in NR and qurrency, see §4 and §7.
- **Notary/submitter:** Zeto itself has no notary. The submitter sees whatever the prover gave it. In Paladin, that is the full witness when a remote prover is used (GAP: Paladin not examined here).

---

## 3. Who submits (msg.sender)

- `transfer()` (`lib/zeto_fungible.sol:127-155` @HEAD) has **no check tying msg.sender to the owner**. Ownership is proven only in the ZK proof via `BabyPbk(inputOwnerPrivateKey)`. msg.sender is not a public input: the NR layout (`…non_repudiation.sol:125-134`) and qurrency layout (`:93-99`) contain no sender. The submitter is emitted publicly as `address indexed submitter` (`IZeto.sol:38`). Grade A (contract + circuit main lines).
- Docs agree and advise a fresh signing key per transaction: `doc-site/docs/concepts/how-zeto-works.md:22`.
- Consequence (C): the proof is not bound to the submitter, so anyone can resubmit an observed proof, for example by front-running. Outputs are fixed by the proof, so value cannot be stolen that way.
- Locked spends:
  - HEAD: the lock's `spender == msg.sender` is checked at the contract layer (`lib/zeto_lockable_lib.sol:382`), and the circuit does not bind it. The qurrency contract comment `zeto_anon_nullifier_qurrency.sol:37-45` says so explicitly.
  - v0.2.2: msg.sender was a public input `lockDelegate` in the transferLocked circuits (`anon_nullifier_transferLocked.circom:20` @v0.2.2; `zeto_anon_nullifier_qurrency.sol:111-113` @v0.2.2), and there was a delegate check in `lib/zeto_base.sol:114-123` @v0.2.2.
- `mint()` is `onlyOwner` (`lib/zeto_common.sol:106-110` @HEAD). The owner can mint arbitrary unbacked UTXOs, and the values are not visible on chain (B).

---

## 4. Regulator / auditor view: non-repudiation variant

**What is encrypted to the authority.** Base template `zkp/circuits/basetokens/anon_enc_nullifier_non_repudiation_base.circom:117-142`, identical at v0.2.2 (`git diff --stat` shows no change). The plaintext contains:
- the input owner public key (x, y);
- value and salt of every input;
- the public key of every output owner;
- value and salt of every output.

The authority therefore sees sender, receivers and all amounts of every transfer. Grade A: circuit plus the contract natspec `…non_repudiation.sol:29-36`.

**Encryption scheme.**
- BabyJubjub ECDH between the ephemeral `ecdhPrivateKey` and `authorityPublicKey` (line 115).
- The same ephemeral key is reused for the receivers' envelopes.
- The cipher is Poseidon-sponge encryption (Dusk construction; `lib/encrypt.circom:21-24,60-74`) with the public `encryptionNonce`, which must be < 2^128 (`encrypt.circom:31`).

**Where the key is set.**
- `setArbiter(uint256[2]) public onlyOwner` (`…non_repudiation.sol:85-87` @HEAD; `:88-90` @v0.2.2).
- It is **not** set in `initialize` (`:62-83` @HEAD; `:64-69` @v0.2.2). It stays (0,0) until the owner calls it; tests call it after deploy (`solidity/test/zeto_anon_enc_nullifier_non_repudiation.ts:100`).
- The key is a public input, read from storage at verify time (`:269-278`).

**Rotation.**
- The owner can call `setArbiter` at any time. There is no timelock, no event and no two-party control: grep for `emit` inside `setArbiter` finds none.
- A rotation takes effect immediately for all future proofs. Past envelopes stay decryptable only by the old key.
- Grade B/A: contract function plus the circuit taking `authorityPublicKey` as a public input.

**Upgradeability.**
- UUPS. `Zeto_AnonEncNullifierNonRepudiation` → `Zeto_AnonEncNullifier` → `Zeto_AnonNullifier is ZetoFungibleNullifier, UUPSUpgradeable` with `_authorizeUpgrade(address) internal override onlyOwner {}` (`zeto_anon_nullifier.sol:35,66` @HEAD; `…non_repudiation.sol:86` @v0.2.2).
- Ownership:
  - HEAD: `Ownable2StepUpgradeable` (`lib/zeto_common.sol:42`).
  - v0.2.2: `OwnableUpgradeable`.
- An upgrade can replace verifiers and logic, and so can change or remove the authority requirement entirely (C, follows from UUPS).
- Searches run: `grep -rn "UUPSUpgradeable|_authorizeUpgrade|Ownable" solidity/contracts`, and `grep -rn "arbiter|authority" solidity/contracts` outside NR. The only other hits are lock "spending authority" comments in `ILockableCapability.sol:101,203`.

**Doc mismatch (minor).**
- NR docs say the authority envelope contains "ownership information" (`doc-site/docs/implementations/anon_enc_nullifier_non_repudiation.md:11`) and the "receiver's UTXO values" (`:21`).
- The contract natspec says "the same plaintext is encrypted to both receiver and arbiter" (`…non_repudiation.sol:31-33`).
- The circuit actually encrypts a strict superset to the authority (all inputs, outputs, owners), while the receiver gets only (value, salt) of its own output (`lib/encrypt-outputs.circom`).

**KYC variant.**
- Registry: an SMT of Poseidon(pubkey) leaves (`solidity/contracts/lib/registry.sol` @HEAD `_register`/`_getIdentitiesLeafNodeHash`).
- `register()` is `onlyOwner`, so the token owner controls membership.
- `emit IdentityRegistered(publicKey, data)` publishes every registered Baby Jubjub key in the clear.
- No revoke or deregister function: `grep -n "revoke|deregister|unregister|remove"` on `registry.sol` and `IZetoKyc.sol` returns nothing.
- What the circuit proves: the sender key and every non-zero output owner key are members of the SMT (`basetokens/anon_enc_nullifier_kyc_base.circom:98-110`; `lib/kyc.circom`). Owners stay hidden among the registered set. Grade A: circuit plus docs `anon_nullifier_kyc.md:9-20`.
- Deposit KYC gap:
  - v0.2.2: the KYC contracts use the plain `Groth16Verifier_Deposit` (`zeto_anon_nullifier_kyc.sol:19,70` @v0.2.2), so deposit outputs are not KYC-checked there (B).
  - HEAD: adds `deposit_kyc.circom:46` (public outputCommitments, identitiesRoot).
- Depth mismatch: the identities SMT is verified with **10 levels** in the circuit (`anon_nullifier_kyc_transfer.circom:20` `transfer(2,2,64,10)`), while the contract tree is initialised to `MAX_SMT_DEPTH = 64` (`registry.sol:58`, `IZeto.sol:19`). C: once the registry grows past roughly tens to hundreds of keys, some leaves will sit deeper than 10 and those users cannot prove membership. This is a liveness limit.
- Skip rule: the KYC check skips any key whose x = 0 (`lib/kyc.circom` `isPubKeyZero`). C: that point corresponds to well-known private key 0, so it is not a practical bypass.

---

## 5. Trusted setup

**Proving system and ptau.**
- Groth16 only: `npx snarkjs groth16 setup` (`zkp/circuits/scripts/gen.js:211`, same at v0.2.2). Verifier contracts are `Groth16Verifier_*`.
- Grep for `plonk` and `fflonk` in the scripts found nothing.
- ptau is the Hermez `powersOfTau28_hez_final_{11..22}`, downloaded from `https://storage.googleapis.com/zkevm/ptau/${ptau}.ptau` (`gen.js:134`, both commits). It is hash-checked against `scripts/ptau_valid_hashes.json` (`gen.js:151-162`). Per-circuit exponents are in `scripts/gen-config.json` (for example qurrency 21, batch 22; NR 17, batch 19).

**Phase 2: no contribution.**
- The zkey is produced directly by `groth16 setup`, and nothing calls `zkey contribute` or `beacon`. The only hits for `contribute|beacon` across `zkp/`, `.github/` and `doc-site/` are doc prose.
- `zkp/circuits/README.md:109` (both commits): "generates **UNSAFE** proving keys that should NOT be used in production … skips the phase 2 … It also allows us to check in the verification logic in the verifier solidity libraries, which is derived from the proving key generated this way without any randomness."
- `README.md:125`: "Solidity verifiers have already been generated from the UNSAFE test proving keys."

**Verified in the verifier constants (A).**
- In **30/30** `solidity/contracts/verifiers/impl/*.sol` @HEAD and **32/32** `verifiers/*.sol` @v0.2.2, `deltax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634`. That equals `gammax1` (`impl/anon.sol:36-43`), which is the BN254 G2 generator. So δ = γ = 1 (snarkjs 0.7.5 `zkey_new.js:119-130` writes the generator as delta).
- C: with δ = γ known, anyone can forge Groth16 proofs (a known result). The checked-in verifiers are unsound for real value.

**Release artifacts.**
- `release.yaml:82-83` @HEAD (v0.2.2 `:45-46`) tars them as `zeto-test-proving-keys*.tar.gz` and `zeto-qurrency-test-proving-keys*.tar.gz`, produced by `npm run gen` (`e2e-deps.yaml:58`).
- CI fails if `npm run gen` changes the repo (`e2e-deps.yaml:60`), which is consistent with deterministic, randomness-free keys (C).

**Other.**
- `scripts/check_ptau.sh:10` @HEAD hard-codes a developer path `cd /Users/jimzhang/workspace.zkp/zeto/zkp/circuits`. It is a dev-only script.
- Production guidance is only a pointer to snarkjs ceremony docs (`README.md:112`).

---

## 6. Sizes and limits

- Batch sizes: 2x2 by default and 10x10 batch. `MAX_BATCH = 10` (`IZeto.sol:18`, both). Padding logic is in `zeto_common.sol:149-180`.
- NF: 1x1 (`nf_anon.circom:56`, `nf_anon_nullifier_transfer.circom:57`).
- Withdraw: n inputs → 1 output.
- Deposit: 2 outputs, no batch (`deposit.circom:20`).
- Burn: n → 1.
- UTXO SMT: 64 levels in the circuits (`…(2,2,64)`) and `MAX_SMT_DEPTH = 64` in the contract (`IZeto.sol:19`).
- Identities SMT: 10 levels (see §4).
- Value range:
  - Outputs are range-checked to [0, 2^100) via `GreaterEqThan(100)` (`lib/check-positive.circom:34`, both). Docs agree for most variants (`anon_nullifier_kyc.md:15`, `…non_repudiation.md:15`, `anon_nullifier_qurrency.md:27`).
  - **Disagreement:** `doc-site/docs/implementations/anon.md:12` and the natspec of 9 contracts say `2**40 - 1` (`zeto_anon.sol:26`, `zeto_anon_enc.sol:29`, `zeto_anon_nullifier.sol:30`, `zeto_anon_enc_nullifier.sol:29`, `zeto_anon_nullifier_kyc.sol:29`, `zeto_anon_enc_nullifier_kyc.sol:29`, burnables `:31`, `erc20.sol:24`). The circuit enforces 2^100.
  - Inputs are NOT range-checked (see §0).
- Decimals are a display-only 4 (`lib/zeto_common.sol:93-95`).

---

## 7. Qurrency (post-quantum auditor envelope)

**HEAD** (`basetokens/anon_nullifier_qurrency__transfer_base.circom`):
- The circuit runs ML-KEM-512 encapsulation (`lib/kyber/mlkem.circom:24-28`) with a private 256-bit `randomness`.
- The auditor's encapsulation key is hard-coded:
  - `t`/`A` live in `lib/kyber/kyber.circom:118-128`;
  - `H(ek)` is a constant bit array in `mlkem.circom:75`.
- The shared secret K becomes a BabyJub key through `PublicKeyFromSeed` (`lib/pubkey.circom`) and then drives Poseidon encryption of the same plaintext as NR: input owner pk, input values and salts, output owner pks, output values and salts.
- Outputs: `c[25]` (the KEM ciphertext) and `cipherTextAuthority`.
- Nothing extra is encrypted to the receiver. Plain anon_nullifier data availability applies (off-chain).
- Docs agree: `anon_nullifier_qurrency.md:9-33`, where `:16-17` says the key is "statically programmed into the circuit … deployer MUST update the circuit … and re-compile".
- **Rotation** = new circuit + new setup + new verifier + contract upgrade or redeploy. The contract has no key setter: grep `arbiter|authority` in `zeto_anon_nullifier_qurrency.sol` finds nothing.

**Finding — WITHHELD.** **Withheld pending coordinated disclosure to Zeto/Paladin** (as of [not yet sent]). The full write-up is held privately until a fix ships or the embargo ends; the row is kept so numbering and links resolve. See `CLAIMS.md` row F-3.

**Finding: the default key is public (A).**
- The ML-KEM secret key and seed for the key compiled into the circuit are committed at `zkp/js/lib/testKeypair.js:18-30`: "correspond to the public key statically configured in the circuit … Only used for testing".
- `solidity/test/zeto_anon_nullifier_qurrency.ts:401-415` decapsulates with it.
- Released qurrency keys use this circuit (`release.yaml:83`).

**v0.2.2: a prototype with no audit binding (B).**
- The circuit has `signal input m[256]`, an unconstrained message, and `kyber_enc()(randomness, m)` outputs only a SHA-256 hash `ct_h0, ct_h1`. The comments say `// TODO: kyber encryption constraints` (`basetokens/anon_nullifier_qurrency__transfer_base.circom` @v0.2.2 lines 31-56 of the file body).
- The contract only checks `calculateHash(ciphertext)` and emits a plain `UTXOTransfer` without the ciphertext (`zeto_anon_nullifier_qurrency.sol:142-166` @v0.2.2).
- So at v0.2.2 the ciphertext is not tied to any transaction secret.

---

## 8. Docs vs circuits; SECURITY.md

- `SECURITY.md` contains only a pointer to Paladin's security policy. There are no known-issue notes anywhere in `doc-site/docs`: grep for "known issue", "UNSAFE", "production" hit only the README lines quoted in §5.
- Disagreements:
  - The 2^40 vs 2^100 range (§6).
  - The NR "same plaintext" natspec vs the superset actually encrypted (§4).
  - `implementations/index.md:22`, "There is no centralized party to trust". This conflicts with:
    - owner-only `mint`, `setArbiter`, `register` and UUPS upgrade;
    - verifiers generated with no phase-2 contribution (δ=γ, §5);
    - a circuit-level soundness finding, withheld pending disclosure (§0, CLAIMS F-2).
  - a qurrency auditability finding, withheld pending disclosure (§7, CLAIMS F-3).
- Agreement:
  - anon/anon_enc "no history masking" (`anon.md:16`) matches public inputCommitments.
  - The msg.sender guidance (`how-zeto-works.md:22`) matches the contract.
