# Observer harness (Task Zero)

Runs one real Zeto transfer on a local Paladin/Besu devnet, then records what a full-chain
observer reads from the base ledger — raw tx/receipt/block objects plus decoded calldata and
logs — contrasted with what the sending node privately holds. This is the Zeto equivalent of
finding F-1 in the reference XLS-96 study. Observation only: no proof forgery, no exploitation.

The base-ledger read (`observeBaseLedgerTx`, `loadAbi`, `abiJson`, `toJson`) lives in `lib.ts`,
shared with `example/run.ts` §6; `observe.ts` is the CLI around it.

The package is ESM (`"type": "module"`); the CommonJS Paladin SDK is loaded via `createRequire`.
Dependencies are pinned exactly.

## Prerequisites

A running Paladin devnet (see `docs/task-zero/TASK-ZERO-2026-09-26.md §1`): 3 Paladin nodes on
`localhost:31548/31648/31748` and Besu on `localhost:31545`.

```sh
npm install
npm run typecheck        # tsc --noEmit, strict
```

## Observer

```sh
npm run observe                                            # Zeto_AnonNullifier (default)
TOKEN=Zeto_AnonEnc OUT=observer-out-anonenc.json npm run observe
```

| Env | Default | |
|---|---|---|
| `TOKEN` | `Zeto_AnonNullifier` | one of `Zeto_Anon`, `Zeto_AnonEnc`, `Zeto_AnonNullifier` |
| `ABI` | = `TOKEN` | must match `TOKEN`; a mismatch is rejected |
| `BESU_RPC` | `http://localhost:31545` | base-ledger JSON-RPC |
| `NODES_JSON` | the three devnet nodes | `[{"id":"node1","url":"…"}, …]`, at least 3 |
| `ISSUER` / `SENDER` / `RECEIVER` | `centralbank` / `bank1` / `bank2` | identity names |
| `ZETO_DOMAIN` | `zeto` | Paladin domain name |
| `POLL_MS` | `60000` | receipt/deploy wait |
| `OUT` | `./observer-out.json` | output path |

It fails loudly (exit 1) when calldata or the token's logs do not decode against the ABI, the
receipt status is not 1, `tx.to` is not the deployed token, or the base-ledger read fails (the
error names the tx hash and RPC URL).

Output JSON: `observer.summary` (selected fields), `observer.method` and `observer.logs`
(decoded **and** raw), `observer.raw` (full normalized tx/receipt/block), and `nodePrivate`
(`states`, `domainReceipt`, `domainReceiptError`). On Paladin v1.0.0 the Zeto domain receipt
returns `PD210102: Not implemented`; that is recorded, not hidden (CLAIMS F-6).

Committed evidence (re-run 2026-09-27): `observer-out-anonnullifier.json`,
`observer-out-anonenc.json`, and the matching `run-*.log`. The step 3 re-run of this command as
the README's Path A is kept as `observer-out-anonnullifier-2026-09-27c.json` and
`run-anonnullifier-2026-09-27c.log` (CLAIMS E-21).

## Proof benchmark

Extract the Zeto release tarballs (`zeto-wasm.tar.gz`, `zeto-test-proving-keys.tar.gz`, e.g.
v0.5.1) into `artifacts/` (git-ignored), or point elsewhere:

```sh
ZETO_KEYS_DIR=… ZETO_WASM_DIR=… RUNS=20 npm run bench
```

| Env | Default |
|---|---|
| `ZETO_KEYS_DIR` | `./artifacts/keys` (`<circuit>.zkey`, `<circuit>-vkey.json`) |
| `ZETO_WASM_DIR` | `./artifacts/wasm` (`<circuit>_js/<circuit>.wasm`) |
| `RUNS` | `6` (positive integer) |

Times witness calculation and Groth16 proving for `anon` and `anon_enc`, **verifies every
proof** (a failure is fatal), reports true medians, cleans up its temporary witness files (they
contain private values), and terminates the snarkjs worker pool so the process exits.
Output: `docs/task-zero/sources/bench-proof-2026-09-27-runs20.log`.

## Note on ABIs

`abi/*.json` are Zeto **v0.2.2** contract ABIs (`zeto-contracts-v0.2.2.tar.gz`), matching the
version Paladin pins. `Zeto_AnonEncNullifierNonRepudiation.json` (added 2026-09-27 for
`example/run-auditor.ts`) is that variant's ABI from the same release tarball; the variant is
not on the Paladin devnet, so the auditor walkthrough deploys it standalone.

## Review

Both scripts were reviewed by Codex on 2026-09-27 (targeted round, high effort). All 14
findings were fixed in commit `ffc0357`.
