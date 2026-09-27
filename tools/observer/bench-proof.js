// TASK-ZERO proof-generation benchmark (Zeto, Groth16 via snarkjs).
//
// Measures witness calculation and Groth16 prove latency for the `anon` and
// `anon_enc` circuits against Zeto release proving keys, verifies EVERY
// generated proof (any failure is fatal), and reports the on-wire proof size
// and the verification key's public-signal count.
// Measurement only — honest inputs, no forgery.
//
// Artifacts: extract the Zeto release tarballs (e.g. v0.5.1 zeto-wasm.tar.gz and
// zeto-test-proving-keys.tar.gz) and point at them:
//   ZETO_KEYS_DIR  dir with <circuit>.zkey and <circuit>-vkey.json   (default ./artifacts/keys)
//   ZETO_WASM_DIR  dir with <circuit>_js/<circuit>.wasm              (default ./artifacts/wasm)
//   RUNS           positive integer, runs per measurement             (default 6)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { buildPoseidon, buildBabyjub } from "circomlibjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEYS = path.resolve(process.env.ZETO_KEYS_DIR || path.join(here, "artifacts/keys"));
const WASM = path.resolve(process.env.ZETO_WASM_DIR || path.join(here, "artifacts/wasm"));
let RUNS; // validated in main() so a bad value reports cleanly

function parseRuns(raw) {
  if (raw === undefined) return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`RUNS must be a positive integer, got '${raw}'`);
  return n;
}

const toJson = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const mid = s.length / 2;
  const median = s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
  const r = (x) => +x.toFixed(1);
  return { runs: s.length, min: r(s[0]), median: r(median), max: r(s[s.length - 1]) };
}

function artifacts(circuit) {
  const files = {
    wasm: path.join(WASM, `${circuit}_js`, `${circuit}.wasm`),
    zkey: path.join(KEYS, `${circuit}.zkey`),
    vkey: path.join(KEYS, `${circuit}-vkey.json`),
  };
  for (const [kind, f] of Object.entries(files)) {
    if (!fs.existsSync(f)) throw new Error(`missing ${kind} for '${circuit}': ${f} (set ZETO_KEYS_DIR / ZETO_WASM_DIR)`);
  }
  return files;
}

async function timeProve(label, circuit, input, tmpDir) {
  const { wasm, zkey, vkey: vkeyPath } = artifacts(circuit);
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
  const wtns = path.join(tmpDir, `${circuit}.wtns`);

  const tW = [];
  for (let i = 0; i < RUNS; i++) {
    const t = nowMs();
    await snarkjs.wtns.calculate(toJson(input), wasm, wtns);
    tW.push(nowMs() - t);
  }

  const tP = [];
  let proof;
  let publicSignals;
  for (let i = 0; i < RUNS; i++) {
    const t = nowMs();
    ({ proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns));
    tP.push(nowMs() - t);
    // Verify every proof, outside the timed region; any failure is fatal.
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
      throw new Error(`${circuit}: proof ${i + 1}/${RUNS} failed verification`);
    }
  }

  console.log(JSON.stringify({
    label,
    circuit,
    allProofsVerified: true,
    witness_calc_ms: stats(tW),
    prove_ms: stats(tP),
    proof_wire_bytes: 8 * 32, // Groth16/BN254: A(2) + B(4) + C(2) field elements x 32 B
    proof_json_bytes: Buffer.byteLength(JSON.stringify(proof)),
    vkey_public_signal_count: vkey.nPublic,
  }, null, 2));
}

async function terminateCurves() {
  const seen = new Set();
  for (const c of [await snarkjs.curves.getCurveFromName("bn128").catch(() => null), globalThis.curve_bn128]) {
    if (c && !seen.has(c) && typeof c.terminate === "function") {
      seen.add(c);
      await c.terminate();
    }
  }
}

async function main() {
  RUNS = parseRuns(process.env.RUNS);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeto-bench-"));
  try {
    const P = await buildPoseidon();
    const B = await buildBabyjub();
    const h = (a) => P.F.toObject(P(a.map(BigInt)));
    const pub = (sk) => B.mulPointEscalar(B.Base8, sk).map((x) => B.F.toObject(x));
    const skA = 123456789n;
    const A = pub(skA); // sender
    const R = pub(987654321n); // receiver
    // 1 real input of 100000 (+ a zero padding slot) -> 1000 to R + 99000 change to A.
    const anonInput = {
      inputCommitments: [h([100000, 111n, A[0], A[1]]), 0],
      inputValues: [100000, 0],
      inputSalts: [111n, 0],
      inputOwnerPrivateKey: skA,
      outputCommitments: [h([1000, 222n, R[0], R[1]]), h([99000, 333n, A[0], A[1]])],
      outputValues: [1000, 99000],
      outputSalts: [222n, 333n],
      outputOwnerPublicKeys: [R, A],
    };
    await timeProve("anon (Zeto_Anon, no nullifier/no enc)", "anon", anonInput, tmpDir);
    await timeProve("anon_enc (Zeto_AnonEnc, ECDH-encrypted values)", "anon_enc",
      { ...anonInput, ecdhPrivateKey: 555555n, encryptionNonce: 111222333n }, tmpDir);
  } finally {
    // Each cleanup step runs regardless of the other; a cleanup failure never masks the
    // benchmark's own error (main's rejection), it is reported alongside it.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true }); // witnesses contain private values
    } catch (e) {
      console.error(`cleanup: could not remove ${tmpDir}: ${e?.message || e}`);
      process.exitCode = 1;
    }
    try {
      await terminateCurves();
    } catch (e) {
      console.error(`cleanup: could not terminate snarkjs workers: ${e?.message || e}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error("BENCH FAILED:", e?.message || e);
  process.exitCode = 1;
});
