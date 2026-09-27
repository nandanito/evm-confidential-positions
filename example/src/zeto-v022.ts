/**
 * The Zeto v0.2.2 inputs of the auditor walkthrough, loaded from the git-ignored
 * `artifacts/zeto-v0.2.2/` that `npm run setup:auditor` (tools/fetch-zeto-v0.2.2.sh) fills.
 *
 * Everything is taken at the tag Paladin v1.0.0 pins (CLAIMS E-2): the release's compiled
 * contracts, the non-repudiation circuit's wasm, its proving key, and Zeto's own zkp/js
 * helpers (Poseidon cipher, proof encoding). The proving key is one of Zeto's UNSAFE test
 * keys (no phase-2 contribution, delta = gamma; CLAIMS E-5, P-2).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const ZETO_TAG = "v0.2.2";
export const ZETO_COMMIT = "5539a36487b004219a47642c2b32110df1b807db";
export const NR_TOKEN = "Zeto_AnonEncNullifierNonRepudiation";
export const NR_CIRCUIT = "anon_enc_nullifier_non_repudiation";

export const ARTIFACTS = process.env.ZETO_ARTIFACTS || fileURLToPath(new URL("../../artifacts/zeto-v0.2.2/", import.meta.url));

const CONTRACTS = join(ARTIFACTS, "contracts/artifacts");

export const PATHS = {
  manifest: join(ARTIFACTS, "MANIFEST.txt"),
  wasm: join(ARTIFACTS, `circuits/${NR_CIRCUIT}_js/${NR_CIRCUIT}.wasm`),
  zkey: join(ARTIFACTS, `circuits/${NR_CIRCUIT}.zkey`),
  vkey: join(ARTIFACTS, `circuits/${NR_CIRCUIT}-vkey.json`),
  zkpJs: join(ARTIFACTS, "zkp-js/index.js"),
  contract: (sol: string, name: string) => join(CONTRACTS, "contracts", sol, `${name}.json`),
  iden3: (sol: string, name: string) => join(CONTRACTS, "@iden3/contracts/contracts/lib", sol, `${name}.json`),
};

/** Fail with the setup command if anything the walkthrough needs is missing. */
export function assertArtifacts(): void {
  const need = [PATHS.manifest, PATHS.wasm, PATHS.zkey, PATHS.vkey, PATHS.zkpJs, PATHS.contract("zeto_anon_enc_nullifier_non_repudiation.sol", NR_TOKEN)];
  const missing = need.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`Zeto ${ZETO_TAG} artifacts missing (${missing.join(", ")}). Run: npm run setup:auditor`);
  const manifest = readFileSync(PATHS.manifest, "utf8");
  if (!manifest.includes(`commit ${ZETO_COMMIT}`)) throw new Error(`${PATHS.manifest} does not record the pinned commit ${ZETO_COMMIT}; re-run npm run setup:auditor`);
}

export interface HardhatArtifact {
  contractName: string;
  abi: any[];
  bytecode: string;
  deployedBytecode: string;
  linkReferences: Record<string, Record<string, { start: number; length: number }[]>>;
}

export function artifact(path: string): HardhatArtifact {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Zeto's zkp/js at the pinned tag (CommonJS; loaded at run time because it is git-ignored). */
export interface ZkpJs {
  Poseidon: { poseidon3: (x: bigint[]) => bigint; poseidon4: (x: bigint[]) => bigint };
  newSalt: () => bigint;
  newEncryptionNonce: () => bigint;
  poseidonDecrypt: (ciphertext: bigint[], key: bigint[], nonce: bigint, length: number) => bigint[];
  encodeProof: (proof: any) => { pA: string[]; pB: string[][]; pC: string[] };
}
export function zkpJs(): ZkpJs {
  return require(PATHS.zkpJs);
}
