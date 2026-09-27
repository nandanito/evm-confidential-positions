/**
 * Output for the walkthrough: a transcript (console + file), a check registry whose
 * failures set the exit code, and the disclosure banner every run prints first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Printed before anything else, so no startup failure can exit above it. */
export const DISCLOSURE_BANNER = [
  "================================================================================",
  " STUDY ON A LOCAL DEVNET. NOT FOR VALUE.",
  " - The Groth16 verifiers use Zeto's shipped UNSAFE test keys (no phase-2 setup;",
  "   delta = gamma). They give no soundness for real value (CLAIMS.md E-5, P-2).",
  " - Each Paladin node holds every key and all plaintext for its desks (E-8, P-10).",
  " - The submitter EOA, timing, gas and note count are public (F-1, P-4, P-6).",
  " - No public audit of Zeto or Paladin was found in the searched corpus (E-11).",
  "================================================================================",
].join("\n");

export class Transcript {
  private readonly lines: string[] = [];
  say(...parts: unknown[]): void {
    const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p, bigintSafe, 2))).join(" ");
    console.log(line);
    this.lines.push(line);
  }
  section(title: string): void {
    this.say(`\n${"-".repeat(80)}\n${title}\n${"-".repeat(80)}`);
  }
  write(dir: string, name: string): string {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, this.lines.join("\n") + "\n");
    return p;
  }
}

export interface CheckResult {
  section: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export class Checks {
  readonly results: CheckResult[] = [];
  constructor(private readonly t: Transcript) {}
  check(section: string, label: string, ok: boolean, detail?: string): boolean {
    this.results.push({ section, label, ok, detail });
    this.t.say(`  ${ok ? "PASS" : "FAIL"}  [${section}] ${label}${detail ? `\n        ${detail}` : ""}`);
    return ok;
  }
  get failed(): CheckResult[] {
    return this.results.filter((r) => !r.ok);
  }
}

export function bigintSafe(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

export function writeJson(dir: string, name: string, data: unknown): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data, bigintSafe, 2) + "\n");
  return p;
}
