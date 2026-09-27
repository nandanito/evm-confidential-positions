/**
 * Falsification test for the disclosure gate: runs the real CLI as a subprocess,
 * once clean and once per injected overclaim, and asserts the exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const GATE = join(ROOT, "tools", "check-disclosure.ts");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

function runGate(extra?: { text: string; as?: string }) {
  const env = { ...process.env };
  let dir: string | undefined;
  if (extra) {
    dir = mkdtempSync(join(tmpdir(), "disclosure-"));
    const f = join(dir, "injected.md");
    writeFileSync(f, extra.text);
    env.DISCLOSURE_EXTRA = f;
    env.DISCLOSURE_EXTRA_AS = extra.as ?? "example/injected.md";
  }
  try {
    const r = spawnSync(TSX, [GATE], { cwd: ROOT, env, encoding: "utf8" });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

test("the gate passes on the repository as committed", () => {
  const r = runGate();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS:/);
});

const OVERCLAIMS: Array<[string, string, RegExp]> = [
  ["production-ready + trustless", "This confidential transfer is production-ready and trustless.", /P-1 (production-ready|trustless)/],
  ["audited", "Zeto has been audited.", /P-1 audited/],
  ["secure", "Desks exchange positions securely on Zeto.", /P-1 secure/],
  ["hides who transacts", "Zeto hides who transacts.", /P-4 hides who transacts/],
  ["no trusted setup", "Zeto needs no trusted setup.", /P-9 no trusted setup/],
  ["single nullifier gas figure", "An AnonNullifier transfer costs 1,381,377 gas.", /P-8 single gas figure/],
  ["issuer view on a stock token", "The issuer can decrypt every desk's position.", /P-5/],
  ["F-2 containment sentinel", "A sentence with the withheld-finding-marker token.", /F-2/],
  ["pending row cited as support", "End-to-end latency is 3 s (B-1).", /CITE pending row/],
  ["unknown row id", "As shown in E-999.", /CITE unknown row/],
  // Codex review 2026-09-27: four false negatives, now pinned.
  ["unknown row inside a comparison sentence", "XLS-96 differs; see E-999.", /CITE unknown row/],
  ["one pending qualifier covering another row", "Latency is 3 s (B-1), while B-2 is pending.", /CITE pending row/],
  ["a second, un-negated occurrence", "The devnet is not secure, but the deployment is secure.", /P-1 secure/],
  ["a fixed gas figure outside the observed band", "An AnonNullifier transfer costs 3,500,000 gas.", /P-8 single gas figure/],
  // Step 2 (2026-09-27): naming the non-repudiation variant must not excuse a stock-variant claim.
  ["a stock variant given the auditor view next to non-repudiation", "Like the non-repudiation variant, Zeto_AnonNullifier gives the auditor view.", /P-5/],
  ["'only' next to a stock variant (Codex review)", "Only Zeto_AnonNullifier gives the auditor view; the non-repudiation variant does not.", /P-5/],
  ["negation on the wrong subject (targeted Codex round)", "Zeto_AnonNullifier gives the auditor view and the non-repudiation variant does not.", /P-5/],
  ["a generic stock phrase in the subject's clause (targeted Codex round)", "The stock devnet variants give the auditor view just as the non-repudiation variant does.", /P-5/],
  ["the stock devnet variants decryptable by an authority", "An authority can decrypt the stock devnet variants' transfers, as in the non-repudiation variant.", /P-5/],
];

for (const [name, text, rule] of OVERCLAIMS) {
  test(`an injected overclaim fails the gate: ${name}`, () => {
    const r = runGate({ text: `# Injected\n\nSome honest prose.\n\n${text}\n` });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /example\/injected\.md:5/);
    assert.match(r.out, rule);
  });
}

test("a required disclosure missing from a recorded transcript fails the gate", () => {
  const r = runGate({ text: "a transcript that never mentions the keys\n", as: "example/out/injected.log" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /REQUIRED disclosure missing/);
});

// Step 3 (2026-09-27): the rebuilt README's honesty sections are required, each on its own.
const README_OK = [
  "# Title",
  "",
  "The keys are UNSAFE test keys (E-5).",
  "",
  "## Trust model",
  "",
  "## What is NOT hidden",
  "",
  "## Open gaps",
  "",
  "<!-- counts:begin x -->",
  "<!-- counts:end -->",
  "",
].join("\n");

test("a README with every required section passes the required-disclosure scan", () => {
  const r = runGate({ text: README_OK, as: "README.md" });
  assert.equal(r.code, 0, r.out);
});

for (const [name, drop, why] of [
  ["the 'What is NOT hidden' heading", "## What is NOT hidden", /What is NOT hidden/],
  ["the 'Open gaps' heading", "## Open gaps", /Open gaps/],
  ["the 'Trust model' heading", "## Trust model", /Trust model/],
  ["the generated counts block", "<!-- counts:begin x -->", /counts block/],
] as const) {
  test(`a README without ${name} fails the gate`, () => {
    const r = runGate({ text: README_OK.replace(drop, ""), as: "README.md" });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /README\.md:0\s+\[REQUIRED disclosure missing\]/);
    assert.match(r.out, why);
  });
}

test("a crashed transcript's stack frame '<anonymous>' is not an anonymity claim", () => {
  const r = runGate({
    text: "UNSAFE test keys\nERROR: boom\n    at async <anonymous> (example/run.ts:245:3)\n",
    as: "example/out/injected.log",
  });
  assert.equal(r.code, 0, r.out);
});

test("the honest version of the same sentences passes", () => {
  const r = runGate({
    text: [
      "# Injected",
      "",
      "Nothing here is production-ready, trustless or audited (E-11 found no audit).",
      "",
      "Zeto does not hide who transacts: the submitter EOA is public (F-1).",
      "",
      "XLS-96 needs no trusted setup (Bulletproofs); Zeto needs one per circuit (E-5).",
      "",
      "AnonNullifier transfer gas is data-dependent, 1.38 M–1.72 M across runs (E-10).",
      "",
      "End-to-end latency is not measured (B-1, pending).",
      "",
      "In Zeto_AnonEncNullifierNonRepudiation the authority can decrypt every input and output of a transfer (E-19).",
      "",
      "The non-repudiation authority can see sender, receivers and amounts. Zeto_AnonNullifier has no such view.",
      "",
      "In the deployed nonrepudiation variant, the auditor can decrypt every value.",
      "",
    ].join("\n"),
  });
  assert.equal(r.code, 0, r.out);
});
