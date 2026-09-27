/**
 * A standalone Zeto_AnonEncNullifierNonRepudiation client: deploy, set the arbiter, mint,
 * prove and submit a transfer — with ethers against the Besu node, and client-side proving
 * with snarkjs and Zeto's zkp/js, all at Zeto v0.2.2 (the version Paladin v1.0.0 pins).
 *
 * Why not Paladin: Paladin v1.0.0's Zeto domain cannot drive this variant (no config entry,
 * no circuit or key in the image, no arbiter handling in the domain code) — see
 * docs/step2/AUDITOR-VARIANT-2026-09-27.md §1. So this module holds the desks' Baby Jubjub
 * keys itself, in process memory, for the length of one run; that is a custody model of its
 * own (one process holds every key), stated in the walkthrough.
 *
 * Deployment mirrors Zeto's own `scripts/deploy_upgradeable.ts` @ v0.2.2: Poseidon libraries
 * from circomlibjs, SmtLib, the five verifiers, the implementation linked to them, behind a
 * UUPS ERC1967 proxy (OpenZeppelin 5.4.0, the version Zeto v0.2.2's lockfile resolves).
 *
 * Every proof here is an honest proof of an honest witness. Nothing is forged or altered.
 */
import { createRequire } from "node:module";
import { ethers } from "ethers";
import { NR_TOKEN, PATHS, artifact, zkpJs, type HardhatArtifact } from "./zeto-v022.ts";
import type { Point, Witness } from "./envelopes.ts";

const require = createRequire(import.meta.url);
const snarkjs: any = require("snarkjs");
const circomlibjs: any = require("circomlibjs");
const maci: any = require("maci-crypto");
const merkletree: any = require("@iden3/js-merkletree");
const ERC1967Proxy: HardhatArtifact = require("@openzeppelin/contracts/build/contracts/ERC1967Proxy.json");

const zk = zkpJs();
export const hash4 = (x: bigint[]): bigint => zk.Poseidon.poseidon4(x);
const hash3 = (x: bigint[]): bigint => zk.Poseidon.poseidon3(x);
const SMT_LEVELS = 64; // `Zeto(2, 2, 64)` in the v0.2.2 circuit main
const GAS = { gasPrice: 0n }; // Besu QBFT devnet, gasPrice=0 (CLAIMS E-10)

/** A Baby Jubjub identity, generated the way Zeto's own tests do (maci-crypto). */
export interface BjjKey {
  name: string;
  priv: bigint; // raw private key
  formatted: bigint; // formatPrivKeyForBabyJub(priv): what the circuit takes
  pub: Point;
}
export function newBjjKey(name: string): BjjKey {
  const { privKey, pubKey } = maci.genKeypair();
  return { name, priv: BigInt(privKey), formatted: BigInt(maci.formatPrivKeyForBabyJub(privKey)), pub: [BigInt(pubKey[0]), BigInt(pubKey[1])] };
}
/** ECDH shared key from our private key and the sender's ephemeral public key (maci-crypto). */
export function sharedKey(k: BjjKey, ecdhPublicKey: Point): bigint[] {
  return maci.genEcdhSharedKey(k.priv, ecdhPublicKey).map(BigInt);
}

export interface Note {
  owner: BjjKey;
  value: bigint;
  salt: bigint;
  commitment: bigint;
}
export function newNote(owner: BjjKey, value: bigint): Note {
  const salt = zk.newSalt();
  return { owner, value, salt, commitment: hash4([value, salt, owner.pub[0], owner.pub[1]]) };
}
export function nullifier(n: Note): bigint {
  return hash3([n.value, n.salt, n.owner.formatted]);
}

/** Replace `__$…$__` library placeholders at the artifact's link offsets. */
export function link(a: HardhatArtifact, libs: Record<string, string>): string {
  let code = a.bytecode.slice(2);
  for (const [, byName] of Object.entries(a.linkReferences)) {
    for (const [name, refs] of Object.entries(byName)) {
      const addr = libs[name];
      if (!addr) throw new Error(`${a.contractName}: no address for linked library ${name}`);
      for (const { start, length } of refs) {
        code = code.slice(0, start * 2) + addr.slice(2).toLowerCase().padStart(length * 2, "0") + code.slice((start + length) * 2);
      }
    }
  }
  if (/__\$/.test(code)) throw new Error(`${a.contractName}: unlinked placeholder left in bytecode`);
  return "0x" + code;
}

export interface Deployment {
  proxy: string;
  implementation: string;
  verifier: string;
  libraries: Record<string, string>;
  txs: { what: string; hash: string; gasUsed: string }[];
}

async function deployRaw(owner: ethers.Signer & { address: string }, what: string, abi: any[], bytecode: string, args: unknown[], txs: Deployment["txs"]): Promise<string> {
  const f = new ethers.ContractFactory(abi, bytecode, owner);
  const c = await f.deploy(...args, GAS);
  const rc = await c.deploymentTransaction()!.wait();
  if (!rc || rc.status !== 1) throw new Error(`deploy ${what} failed`);
  txs.push({ what, hash: rc.hash, gasUsed: rc.gasUsed.toString() });
  return (await c.getAddress()).toLowerCase();
}

/** Deploy the variant exactly as Zeto v0.2.2's upgradeable deploy script does, owned by `owner`. */
export async function deployNonRepudiation(owner: ethers.Signer & { address: string }): Promise<Deployment> {
  const txs: Deployment["txs"] = [];
  const p2 = await deployRaw(owner, "PoseidonUnit2L", circomlibjs.poseidonContract.generateABI(2), circomlibjs.poseidonContract.createCode(2), [], txs);
  const p3 = await deployRaw(owner, "PoseidonUnit3L", circomlibjs.poseidonContract.generateABI(3), circomlibjs.poseidonContract.createCode(3), [], txs);
  const smt = artifact(PATHS.iden3("SmtLib.sol", "SmtLib"));
  const smtLib = await deployRaw(owner, "SmtLib", smt.abi, link(smt, {}), [], txs);
  const v = (sol: string, name: string) => artifact(PATHS.contract(`verifiers/${sol}`, name));
  const verifiers = {
    verifier: v("verifier_anon_enc_nullifier_non_repudiation.sol", "Groth16Verifier_AnonEncNullifierNonRepudiation"),
    batchVerifier: v("verifier_anon_enc_nullifier_non_repudiation_batch.sol", "Groth16Verifier_AnonEncNullifierNonRepudiationBatch"),
    depositVerifier: v("verifier_deposit.sol", "Groth16Verifier_Deposit"),
    withdrawVerifier: v("verifier_withdraw_nullifier.sol", "Groth16Verifier_WithdrawNullifier"),
    batchWithdrawVerifier: v("verifier_withdraw_nullifier_batch.sol", "Groth16Verifier_WithdrawNullifierBatch"),
  };
  const addrs: Record<string, string> = {};
  for (const [k, a] of Object.entries(verifiers)) addrs[k] = await deployRaw(owner, a.contractName, a.abi, link(a, {}), [], txs);

  const impl = artifact(PATHS.contract("zeto_anon_enc_nullifier_non_repudiation.sol", NR_TOKEN));
  const libraries = { PoseidonUnit2L: p2, PoseidonUnit3L: p3, SmtLib: smtLib };
  const implementation = await deployRaw(owner, NR_TOKEN, impl.abi, link(impl, libraries), [], txs);
  // As Zeto's scripts/tokens/Zeto_AnonEncNullifierNonRepudiation.ts @ v0.2.2: no lock or burn verifiers.
  const none = ethers.ZeroAddress;
  const info = { ...addrs, lockVerifier: none, batchLockVerifier: none, burnVerifier: none, batchBurnVerifier: none };
  const init = new ethers.Interface(impl.abi).encodeFunctionData("initialize", ["Auditor study", "AUD", owner.address, info]);
  const proxy = await deployRaw(owner, "ERC1967Proxy", ERC1967Proxy.abi, ERC1967Proxy.bytecode, [implementation, init], txs);
  return { proxy, implementation, verifier: addrs.verifier, libraries, txs };
}

export function token(address: string, runner: ethers.ContractRunner): ethers.Contract {
  return new ethers.Contract(address, artifact(PATHS.contract("zeto_anon_enc_nullifier_non_repudiation.sol", NR_TOKEN)).abi, runner);
}

/** The desks' shared view of the UTXO tree, rebuilt from on-chain outputs (as Zeto's tests do). */
export class Tree {
  private readonly smt: any;
  constructor() {
    this.smt = new merkletree.Merkletree(new merkletree.InMemoryDB(merkletree.str2Bytes("")), true, SMT_LEVELS);
  }
  async add(commitments: bigint[]): Promise<void> {
    for (const c of commitments) if (c !== 0n) await this.smt.add(c, c);
  }
  async root(): Promise<bigint> {
    return (await this.smt.root()).bigInt();
  }
  async siblings(c: bigint): Promise<bigint[]> {
    const p = await this.smt.generateCircomVerifierProof(c, await this.smt.root());
    const s: bigint[] = p.siblings.map((x: any) => x.bigInt());
    if (s.length !== SMT_LEVELS) throw new Error(`merkle proof has ${s.length} siblings, circuit expects ${SMT_LEVELS}`);
    return s;
  }
}

export interface PreparedTransfer {
  witness: Witness;
  args: {
    nullifiers: bigint[];
    outputs: bigint[];
    root: bigint;
    encryptionNonce: bigint;
    ecdhPublicKey: Point;
    encryptedValuesForReceiver: bigint[];
    encryptedValuesForAuthority: bigint[];
    proof: { pA: string[]; pB: string[][]; pC: string[] };
  };
  arbiter: Point; // the authority key the proof was made for
  outputNotes: Note[];
}

/**
 * Build the witness for spending `inputs` (1 or 2 notes of `sender`) into two outputs and prove
 * it with the v0.2.2 wasm + zkey. A single input is padded the way Zeto pads: a zero slot with
 * nullifier 0 and enabled 0.
 */
export async function proveTransfer(a: { sender: BjjKey; inputs: Note[]; outputs: Note[]; tree: Tree; arbiter: Point }): Promise<PreparedTransfer> {
  if (a.inputs.length < 1 || a.inputs.length > 2 || a.outputs.length !== 2) throw new Error("this client proves 1–2 inputs into exactly 2 outputs");
  if (a.inputs.some((n) => n.owner !== a.sender)) throw new Error("every input must belong to the sender");
  const pad = 2 - a.inputs.length;
  const real = [...a.inputs.map(() => true), ...Array(pad).fill(false)];
  const ins = [...a.inputs.map((n) => ({ value: n.value, salt: n.salt, commitment: n.commitment, nullifier: nullifier(n) })), ...Array(pad).fill({ value: 0n, salt: 0n, commitment: 0n, nullifier: 0n })];
  const root = await a.tree.root();
  const merkleProof = await Promise.all(ins.map((x, i) => (real[i] ? a.tree.siblings(x.commitment) : Promise.resolve(Array(SMT_LEVELS).fill(0n)))));
  const ephemeral = maci.genKeypair();
  const encryptionNonce = zk.newEncryptionNonce();
  const input = {
    nullifiers: ins.map((x) => x.nullifier),
    inputCommitments: ins.map((x) => x.commitment),
    inputValues: ins.map((x) => x.value),
    inputSalts: ins.map((x) => x.salt),
    inputOwnerPrivateKey: a.sender.formatted,
    ecdhPrivateKey: BigInt(maci.formatPrivKeyForBabyJub(ephemeral.privKey)),
    root,
    merkleProof,
    enabled: real.map((r) => (r ? 1n : 0n)),
    outputCommitments: a.outputs.map((n) => n.commitment),
    outputValues: a.outputs.map((n) => n.value),
    outputSalts: a.outputs.map((n) => n.salt),
    outputOwnerPublicKeys: a.outputs.map((n) => n.owner.pub),
    encryptionNonce,
    authorityPublicKey: a.arbiter,
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(stringify(input), PATHS.wasm, PATHS.zkey);
  const ps: bigint[] = publicSignals.map(BigInt);
  // Circom order: outputs first (ecdhPublicKey[2], cipherTexts[2][4], cipherTextAuthority[16]),
  // then public inputs in declaration order (the contract's constructPublicInputs, v0.2.2).
  const ecdhPublicKey: Point = [ps[0], ps[1]];
  const expectPub = ephemeral.pubKey.map(BigInt);
  if (ecdhPublicKey[0] !== expectPub[0] || ecdhPublicKey[1] !== expectPub[1]) throw new Error("public signal layout: ecdhPublicKey is not the ephemeral public key");
  return {
    witness: {
      senderKey: a.sender.pub,
      inputs: ins.map((x, i) => ({ value: x.value, salt: x.salt, real: real[i] })),
      outputs: a.outputs.map((n) => ({ ownerKey: n.owner.pub, value: n.value, salt: n.salt })),
    },
    args: {
      nullifiers: input.nullifiers,
      outputs: input.outputCommitments,
      root,
      encryptionNonce,
      ecdhPublicKey,
      encryptedValuesForReceiver: ps.slice(2, 10),
      encryptedValuesForAuthority: ps.slice(10, 26),
      proof: zk.encodeProof(proof),
    },
    arbiter: a.arbiter,
    outputNotes: a.outputs,
  };
}

function callArgs(p: PreparedTransfer): unknown[] {
  const x = p.args;
  return [x.nullifiers, x.outputs, x.root, x.encryptionNonce, x.ecdhPublicKey, x.encryptedValuesForReceiver, x.encryptedValuesForAuthority, x.proof, "0x"];
}

/** Submit a prepared transfer from `submitter`; returns the mined receipt (throws on failure). */
export async function submitTransfer(address: string, submitter: ethers.Signer, p: PreparedTransfer): Promise<ethers.TransactionReceipt> {
  const tx = await token(address, submitter).transfer(...callArgs(p), GAS);
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error(`transfer ${tx.hash} failed`);
  return rc;
}

/** Simulate (eth_call) a prepared transfer; returns the revert reason, or null if it would succeed. */
export async function simulateTransfer(address: string, submitter: ethers.Signer, p: PreparedTransfer): Promise<string | null> {
  try {
    await token(address, submitter).transfer.staticCall(...callArgs(p));
    return null;
  } catch (e: any) {
    return e?.reason ?? e?.revert?.name ?? e?.shortMessage ?? String(e?.message ?? e);
  }
}

/** Stop snarkjs's worker threads so the process can exit. */
export async function terminateProver(): Promise<void> {
  const seen = new Set<unknown>();
  for (const c of [await snarkjs.curves.getCurveFromName("bn128").catch(() => null), (globalThis as any).curve_bn128]) {
    if (c && !seen.has(c) && typeof c.terminate === "function") {
      seen.add(c);
      await c.terminate();
    }
  }
}

function stringify(v: any): any {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(stringify);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stringify(x)]));
  return v;
}
