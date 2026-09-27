#!/usr/bin/env bash
# fetch-zeto-v0.2.2.sh — the Zeto v0.2.2 inputs the auditor walkthrough needs (example/run-auditor.ts).
#
# Paladin v1.0.0 pins Zeto v0.2.2 (CLAIMS E-2), so everything here is taken at that tag:
#   - the release's compiled contracts (zeto-contracts-v0.2.2.tar.gz, Hardhat artifacts);
#   - the non-repudiation circuit's wasm (from zeto-wasm-v0.2.2.tar.gz);
#   - its proving key + verification key, streamed out of zeto-test-proving-keys-v0.2.2.tar.gz
#     (1.27 GB; only the two files are written to disk). These are Zeto's UNSAFE test keys:
#     no phase-2 contribution, delta = gamma (CLAIMS E-5, P-2). Study only, never for value.
#   - zkp/js (Zeto's JS helpers: Poseidon cipher, proof encoding) from the tag's source tarball,
#     whose embedded commit id is checked against the pinned commit.
#
# Output: artifacts/zeto-v0.2.2/ (git-ignored) plus MANIFEST.txt with the sha256 of every
# downloaded tarball and extracted file. Re-running re-downloads and rewrites the manifest.
set -euo pipefail

TAG=v0.2.2
COMMIT=5539a36487b004219a47642c2b32110df1b807db
REL="https://github.com/LFDT-Paladin/zeto/releases/download/${TAG}"
SRC="https://codeload.github.com/LFDT-Paladin/zeto/tar.gz/refs/tags/${TAG}"
CIRCUIT=anon_enc_nullifier_non_repudiation

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/artifacts/zeto-${TAG}"
DL="${OUT}/dl"
mkdir -p "${DL}" "${OUT}/circuits"
MANIFEST="${OUT}/MANIFEST.txt"
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

{
  echo "Zeto ${TAG} (commit ${COMMIT}) fetched $(date -u +%Y-%m-%dT%H:%M:%SZ) by tools/fetch-zeto-v0.2.2.sh"
  echo "UNSAFE test keys: no phase-2 contribution, delta = gamma (CLAIMS E-5). Study only."
} > "${MANIFEST}"

echo "1/4 contracts"
curl -fsSL -o "${DL}/zeto-contracts-${TAG}.tar.gz" "${REL}/zeto-contracts-${TAG}.tar.gz"
rm -rf "${OUT}/contracts" && mkdir -p "${OUT}/contracts"
tar xzf "${DL}/zeto-contracts-${TAG}.tar.gz" -C "${OUT}/contracts"
echo "sha256 $(sha "${DL}/zeto-contracts-${TAG}.tar.gz")  zeto-contracts-${TAG}.tar.gz" >> "${MANIFEST}"

echo "2/4 circuit wasm"
curl -fsSL -o "${DL}/zeto-wasm-${TAG}.tar.gz" "${REL}/zeto-wasm-${TAG}.tar.gz"
tar xzf "${DL}/zeto-wasm-${TAG}.tar.gz" -C "${OUT}/circuits" "${CIRCUIT}_js/${CIRCUIT}.wasm"
echo "sha256 $(sha "${DL}/zeto-wasm-${TAG}.tar.gz")  zeto-wasm-${TAG}.tar.gz" >> "${MANIFEST}"

echo "3/4 proving + verification key (streams 1.27 GB, writes two files)"
KEYS_SHA="${DL}/keys.sha256"
# One pass over the stream: tar reads a fifo in the background while the pipeline hashes
# the same bytes; both are waited for, so neither result is read before it is complete.
FIFO="${DL}/keys.fifo"
rm -f "${FIFO}" && mkfifo "${FIFO}"
tar xzf "${FIFO}" -C "${OUT}/circuits" "${CIRCUIT}.zkey" "${CIRCUIT}-vkey.json" &
TAR_PID=$!
curl -fsSL "${REL}/zeto-test-proving-keys-${TAG}.tar.gz" | tee "${FIFO}" | shasum -a 256 | awk '{print $1}' > "${KEYS_SHA}"
wait "${TAR_PID}"
rm -f "${FIFO}"
echo "sha256 $(cat "${KEYS_SHA}")  zeto-test-proving-keys-${TAG}.tar.gz (streamed)" >> "${MANIFEST}"

echo "4/4 zkp/js source at ${TAG}"
curl -fsSL -o "${DL}/zeto-src-${TAG}.tar.gz" "${SRC}"
# get-tar-commit-id stops reading after the header, so gunzip may die of SIGPIPE: ignore that.
GOT=$( (gunzip -c "${DL}/zeto-src-${TAG}.tar.gz" 2>/dev/null || true) | git get-tar-commit-id)
if [ "${GOT}" != "${COMMIT}" ]; then
  echo "FAIL: source tarball commit ${GOT} != pinned ${COMMIT}" >&2
  exit 1
fi
rm -rf "${OUT}/zkp-js" && mkdir -p "${OUT}/zkp-js"
tar xzf "${DL}/zeto-src-${TAG}.tar.gz" -C "${OUT}/zkp-js" --strip-components=3 "zeto-${TAG#v}/zkp/js/index.js" "zeto-${TAG#v}/zkp/js/lib/util.js" "zeto-${TAG#v}/zkp/js/package.json"
echo "commit ${GOT}  zeto-src-${TAG}.tar.gz (git get-tar-commit-id)" >> "${MANIFEST}"

for f in "circuits/${CIRCUIT}_js/${CIRCUIT}.wasm" "circuits/${CIRCUIT}.zkey" "circuits/${CIRCUIT}-vkey.json" \
  "contracts/artifacts/contracts/zeto_anon_enc_nullifier_non_repudiation.sol/Zeto_AnonEncNullifierNonRepudiation.json" \
  zkp-js/index.js zkp-js/lib/util.js; do
  echo "sha256 $(sha "${OUT}/${f}")  ${f}" >> "${MANIFEST}"
done
rm -f "${DL}"/*.tar.gz "${KEYS_SHA}"
echo "done -> ${OUT}"
cat "${MANIFEST}"
