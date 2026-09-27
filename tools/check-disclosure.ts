/**
 * check-disclosure.ts — the disclosure gate.
 *
 * Fails if README.md, docs/, the example or the example's recorded output claims more
 * privacy or security than CLAIMS.md supports. Shape copied from the reference project's
 * `tools/check-disclosure-phrases.ts` (read-only, method only); the rules are this
 * project's own and are keyed to its standing prohibitions P-1..P-12.
 *
 * What it checks:
 *   1. PROHIBITIONS — lexical rules, one or more per P-row, applied per sentence (or per
 *      table cell). A hit is forgiven only by (a) a negator shortly before it in the same
 *      sentence, for rules where negation is safe ("not audited"), (b) a rule-specific
 *      context that makes the use legitimate ("XLS-96 needs no trusted setup"), or (c) an
 *      explicit waiver `disclosure-ok(P-n): reason` in the sentence or on the line above.
 *      Every waiver is printed, so a waiver is a reviewable decision, not a silent one.
 *   2. CITATIONS — every CLAIMS row id cited (P-/E-/B-/F-n) must exist in CLAIMS.md, and a
 *      PENDING row (B-n) may be cited only as pending/unmeasured, never as support.
 *   3. CONTAINMENT — finding F-2 is pending private disclosure; its specifics must not
 *      appear in README.md or example/.
 *   4. REQUIRED DISCLOSURES — README.md and example/README.md must say the keys are UNSAFE
 *      and (example) carry the NOT-hidden / NOT-demonstrated section; a recorded example
 *      transcript must print the UNSAFE banner.
 *   5. CONTROLS — every rule's bad samples must be caught and good samples must pass,
 *      through the same detector the real scan uses.
 *
 * What it does NOT do:
 *   - It is LEXICAL. A reworded overclaim is invisible to it; it catches phrasings, not
 *     meanings. It cannot tell whether a claim is true. CLAIMS.md stays the human gate.
 *   - Negation forgiveness is a heuristic (a negator within a few words before the hit).
 *     "It is not slow and it is secure" would be caught; "Nothing is slow; it is secure"
 *     would be caught; but a sufficiently contorted sentence can slip past. Controls pin
 *     the cases it is known to handle.
 *   - JSON files under example/ are not scanned: it is the raw machine record (tx/receipt/block
 *     objects). Every human-readable claim a run makes is in its .log transcript, which is.
 *   - Exempt: CLAIMS.md (the register must state each prohibited claim in order to
 *     prohibit it), this file and its test (they contain every phrase), and
 *     docs/task-zero/sources/ (primary-source notes that quote third parties verbatim,
 *     e.g. Zeto's own "no centralized party to trust", CLAIMS F-4).
 *
 * Usage: npm run check:disclosure
 *   DISCLOSURE_EXTRA=<file>      also scan this file (used by the falsification test)
 *   DISCLOSURE_EXTRA_AS=<path>   the repo path to treat it as (default: its basename,
 *                                which puts it in the top-level scope)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** User-facing surfaces. Paths are repo-relative with forward slashes. */
const SCOPE: Array<{ dir: string; ext: string[] }> = [
  { dir: "README.md", ext: [".md"] },
  { dir: "docs", ext: [".md"] },
  // .json under example/out is the raw machine record (tx/receipt/block objects); every
  // human-readable claim a run makes is in its .log transcript, which IS scanned.
  { dir: "example", ext: [".md", ".ts", ".log", ".txt"] },
  { dir: "tools/observer/README.md", ext: [".md"] },
];
const EXEMPT_PREFIXES = ["docs/task-zero/sources/", "example/node_modules/"];
const EXEMPT_FILES = ["CLAIMS.md", "tools/check-disclosure.ts", "tools/check-disclosure.test.ts"];

function posix(p: string): string {
  return p.split(sep).join("/");
}

export function liveFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string, ext: string[]) => {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs)) walk(posix(join(rel, name)), ext);
      return;
    }
    if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p)) || EXEMPT_FILES.includes(rel)) return;
    if (!ext.some((e) => rel.endsWith(e))) return;
    out.push(rel);
  };
  for (const s of SCOPE) walk(s.dir, s.ext);
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// Units: sentences / table cells, with the line each starts on
// ---------------------------------------------------------------------------

export interface Unit {
  text: string;
  line: number; // 1-based line of the unit's first character
  prevLine: string; // the full line above the unit's first line ("" at top of file)
  /** Context for allowIf/detect: the whole table row for a cell (its header cell often
   *  carries the qualifier, e.g. "Proving latency (M3 Pro)"); the unit itself otherwise. */
  context: string;
}

/**
 * Split a file into units. Quote and comment prefixes (`>` in Markdown; `//`, `*`, `/**`
 * in code) are stripped so a sentence wrapped across prefixed lines stays one unit; a new
 * unit starts at a blank line, a heading, a list item, a table row, or a change of prefix.
 */
export function units(text: string, code = false): Unit[] {
  const lines = text.split("\n");
  const out: Unit[] = [];
  let para: { text: string; line: number }[] = [];
  let paraPrefix = "";
  const flush = () => {
    if (!para.length) return;
    // Join the paragraph, remembering where each source line starts.
    let joined = "";
    const starts: { off: number; line: number }[] = [];
    for (const p of para) {
      starts.push({ off: joined.length, line: p.line });
      joined += p.text + " ";
    }
    const lineAt = (off: number) => {
      let ln = starts[0].line;
      for (const s of starts) if (s.off <= off) ln = s.line;
      return ln;
    };
    // Split after . ! ? when followed by whitespace and something sentence-like.
    const re = /[^]*?(?:[.!?](?=\s+[A-Z0-9*`(_\[#>"'~-])|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        if (re.lastIndex > joined.length) break;
        continue;
      }
      const t = m[0].trim();
      if (t) {
        const lead = m[0].length - m[0].trimStart().length;
        const ln = lineAt(m.index + lead);
        out.push({ text: t, line: ln, prevLine: ln >= 2 ? lines[ln - 2] : "", context: t });
      }
    }
    para = [];
  };
  const PREFIX = code ? /^\s*(\/\/+|\/\*\*?|\*(?!\*)|\*\/)\s?/ : /^\s*((?:>\s?)+)/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!code && /^\s*\|/.test(raw)) {
      // A table row: every cell is its own unit.
      flush();
      for (const cell of raw.split("|")) {
        const t = cell.trim();
        if (t) out.push({ text: t, line: i + 1, prevLine: i >= 1 ? lines[i - 1] : "", context: raw });
      }
      continue;
    }
    const pm = PREFIX.exec(raw);
    const prefix = pm ? pm[1].replace(/\s/g, "").replace(/^\/\*\*?$|^\*\/$/, "*") : "";
    const body = pm ? raw.slice(pm[0].length) : raw;
    if (body.trim() === "") {
      flush();
      continue;
    }
    // Headings and list items start a new unit so a negator in one bullet cannot forgive a
    // claim in the next; so does a change of prefix (prose -> comment, quote -> prose).
    if (prefix !== paraPrefix || /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(body)) flush();
    paraPrefix = prefix;
    para.push({ text: body, line: i + 1 });
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface Rule {
  id: string; // the CLAIMS row it enforces
  name: string;
  pattern: RegExp; // case-insensitive, no /g
  /** A negator within NEG_WINDOW words before the hit forgives it. */
  negatable: boolean;
  /** If this matches anywhere in the unit (or, as a function, returns true for the unit's
   *  context), the hit is a legitimate use. */
  allowIf?: RegExp | ((ctx: string) => boolean);
  /** Custom detector (replaces `pattern` when present): `text` is the sentence or table
   *  cell, `ctx` its row context (equal to `text` outside tables). */
  detect?: (text: string, ctx: string) => boolean;
  /** Only files under these repo-path prefixes (default: every scoped file). */
  only?: string[];
  why: string;
  samples: { bad: string[]; good: string[] };
}

const NEG_WINDOW = 8;
const NEGATOR = /^(not|no|never|none|nor|neither|nothing|cannot|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|lacks?|zero)$/i;

function negatedBefore(unit: string, index: number): boolean {
  const before = unit.slice(0, index);
  // Do not look across a clause break.
  // Contrastive conjunctions end the negation's reach; plain commas do not, because list
  // negations ("Nothing here is secure, audited, or production-ready") span them.
  const clause = before.split(/[;:—]|\s-\s|\b(?:but|while|whereas|although|however|yet)\b/i).pop() ?? before;
  const words = clause.split(/[^A-Za-z']+/).filter(Boolean).slice(-NEG_WINDOW);
  return words.some((w) => NEGATOR.test(w) || /n't$/i.test(w));
}

/**
 * Gas-like figures in the formats this repo writes them (1,381,377 · 1381377 · 1.38 M ·
 * 412 k). No upper or lower band: the SMT cost is not bounded by the observed range, so a
 * single figure of any size is a fixed-figure claim. Values under 10,000 are ignored so
 * counts ("2 inputs") and row ids ("E-10") are not mistaken for gas.
 */
function gasFigures(unit: string): number[] {
  const nums: number[] = [];
  for (const m of unit.matchAll(/(?<![\w.,-])(\d{1,3}(?:,\d{3})+)(?![\d,])/g)) nums.push(Number(m[1].replace(/,/g, "")));
  for (const m of unit.matchAll(/(?<![\w.,-])(\d{5,})(?![\d,.])/g)) nums.push(Number(m[1]));
  for (const m of unit.matchAll(/(?<![\w.,-])(\d+(?:\.\d+)?)\s?([MmKk])\b/g)) nums.push(Math.round(Number(m[1]) * (/m/i.test(m[2]) ? 1e6 : 1e3)));
  return [...new Set(nums.filter((n) => n >= 10_000))];
}

const NEG = true;

/**
 * P-5 allow: a decryption view is a legitimate thing to describe only for the variants that
 * have one. FAIL-CLOSED: the unit must be about the non-repudiation or qurrency variant (or
 * XLS-96, or the gap row that tracks it) AND must name no stock devnet variant at all. A
 * sentence that contrasts the two ("Unlike Zeto_AnonNullifier, the non-repudiation authority
 * sees…") is rejected even when accurate: split it into two sentences. A lexical gate cannot
 * tell which subject a negation or "unlike" applies to, and two review rounds found leaks in
 * clause-level heuristics (Codex review 2026-09-27), so this rule does not try.
 * The only exemption: a generic phrase that itself carries the subject ("the deployed
 * nonrepudiation variant") is not a stock mention.
 */
const P5_SUBJECT = /non-?repudiation|NonRepudiation|qurrency|GAP-1|\bB-3\b|XLS-96/i;
// Word boundaries keep Zeto_AnonEncNullifierNonRepudiation from matching Zeto_AnonEnc.
const P5_STOCK_NAME = /\bZeto_Anon(?:Enc|Nullifier|NullifierKyc)?\b/i;
const P5_STOCK_GENERIC = /\bstock\b|\bdefault\s+variants?\b|\b(?:devnet|deployed|these|four)\s+(?:[\w-]+\s+)?variants?\b/gi;
function p5Allowed(ctx: string): boolean {
  if (!P5_SUBJECT.test(ctx) || P5_STOCK_NAME.test(ctx)) return false;
  return [...ctx.matchAll(P5_STOCK_GENERIC)].every((m) => P5_SUBJECT.test(m[0]));
}

export const RULES: Rule[] = [
  // ---- P-1: secure / trustless / non-custodial / production-ready / audited
  {
    id: "P-1", name: "trustless", pattern: /\btrustless(ly)?\b/i, negatable: NEG,
    why: "a stock Paladin/Zeto deployment is not trustless: UNSAFE keys (E-5), node holds all keys (E-8)",
    samples: { bad: ["Positions move trustlessly between desks."], good: ["Nothing here is trustless."] },
  },
  {
    id: "P-1", name: "non-custodial", pattern: /\bnon-?custodial\b/i, negatable: NEG,
    why: "the Paladin node holds and derives every key (E-8)",
    samples: { bad: ["A non-custodial transfer."], good: ["It is not non-custodial: the node holds the keys."] },
  },
  {
    id: "P-1", name: "production-ready", pattern: /\bproduction[- ]?(ready|grade)\b/i, negatable: NEG,
    why: "UNSAFE test keys, no audit found, single-node custody (E-5, E-8, E-11)",
    samples: { bad: ["This is production-ready."], good: ["Nothing here is secure, audited or production-ready."] },
  },
  {
    id: "P-1", name: "audited", pattern: /\baudited\b/i, negatable: NEG,
    why: "no third-party audit was found (E-11)",
    samples: { bad: ["Zeto is audited.", "Audited? Yes, it is audited."], good: ["Zeto has not been audited as far as E-11's search found.", "| **Audited?** | none found |"] },
  },
  {
    id: "P-1", name: "secure", pattern: /\bsecure(ly)?\b/i, negatable: NEG,
    why: "the shipped verifiers use UNSAFE keys (E-5); nothing here is secure for value",
    samples: { bad: ["Desks transfer positions securely.", "The devnet is not secure, but the deployment is secure."], good: ["This devnet is not secure."] },
  },
  {
    id: "P-1", name: "safe to use / battle-tested", pattern: /\b(safe to use|battle[- ]tested)\b/i, negatable: NEG,
    why: "see E-5, E-11",
    samples: { bad: ["It is battle-tested."], good: ["It is not battle-tested."] },
  },
  // ---- P-2: soundness for real value
  {
    id: "P-2", name: "unforgeable", pattern: /\b(unforgeable|forgery[- ]proof|cannot be forged|can(?:no|')t be forged|impossible to forge)\b/i,
    negatable: false,
    why: "the shipped keys have δ=γ; forging with δ=γ is a known result (E-5, P-2)",
    samples: { bad: ["Proofs cannot be forged."], good: ["The proofs are only as sound as the setup (E-5)."] },
  },
  {
    id: "P-2", name: "safe for value", pattern: /\b(safe|sound|suitable|ready) (for|to hold) (real )?(value|funds|money)\b|\bvalue[- ]safe\b/i,
    negatable: NEG,
    why: "UNSAFE test keys: no soundness for real value (E-5)",
    samples: { bad: ["The token is safe for real value."], good: ["It is not safe for real value."] },
  },
  // ---- P-3: versions against the pin
  {
    id: "P-3", name: "Zeto version other than the pin", pattern: /\bZeto v?0\.(?!2\.2\b)\d+\.\d+\b/i, negatable: false,
    allowIf: /\bHEAD\b|\bpin(s|ned)?\b|\bbehind\b|v0\.2\.2|release/i,
    why: "Paladin v1.0.0 pins Zeto v0.2.2; a HEAD version needs to be named as HEAD (E-2, P-3)",
    samples: { bad: ["The example runs on Zeto v0.5.1."], good: ["Zeto HEAD is v0.5.1; Paladin pins Zeto v0.2.2."] },
  },
  // ---- P-4: who transacts
  {
    id: "P-4", name: "hides who transacts",
    pattern: /\bhid(?:es?|ing|den)\s+(?:who\s+(?:transacts|sends|pays|submits|is transacting)|the\s+(?:sender|submitter|payer)\b|(?:all\s+)?(?:sender|submitter)\s+(?:identit|address))/i,
    negatable: NEG,
    why: "the submitter EOA is public and indexed on every transfer (E-6, F-1)",
    samples: { bad: ["Zeto hides who transacts."], good: ["Zeto does not hide who transacts on the base ledger."] },
  },
  {
    // (?<!<): a crashed run's transcript carries Node stack frames ("at async <anonymous> (run.ts:245:3)").
    id: "P-4", name: "anonymous / untraceable", pattern: /(?<!<)\b(anonymous(ly)?|untraceable|fully anonym\w*)\b/i, negatable: NEG,
    why: "submitter EOA, timing, gas and note count are public (E-6, F-1)",
    samples: {
      bad: ["Transfers are untraceable.", "Each <b>anonymous</b> transfer settles."],
      good: ["Transfers are not anonymous: the submitter EOA is public.", "    at async <anonymous> (example/run.ts:245:3)"],
    },
  },
  // ---- P-5: third-party decryption view
  {
    id: "P-5", name: "issuer/auditor/regulator view",
    pattern: /\b(issuer|auditor|regulator|authority)(?:'s)?\s+(?:view|(?:can|could|is able to|may)\s+(?:decrypt|view|see|read)|decrypts|sees)\b/i,
    negatable: NEG,
    allowIf: p5Allowed,
    why: "the four stock devnet variants give no third party a decryption view; only a deployed non-repudiation or qurrency variant has one (E-4, E-19, P-5)",
    samples: {
      bad: [
        "The issuer can decrypt every balance.",
        "Like the non-repudiation variant, Zeto_AnonNullifier gives the auditor view.",
        "An authority can decrypt the stock devnet variants' transfers, as in the non-repudiation variant.",
        "The auditor sees every Zeto_AnonEnc transfer; see NonRepudiation.",
        "Only Zeto_AnonNullifier gives the auditor view; the non-repudiation variant does not.",
        // Targeted Codex round 2026-09-27: negation / "unlike" / a same-clause subject leaked.
        "Zeto_AnonNullifier gives the auditor view and the non-repudiation variant does not.",
        "Zeto_Anon gives the auditor view unlike qurrency.",
        "The stock devnet variants give the auditor view just as the non-repudiation variant does.",
        // Fail-closed by design: accurate, but mixes a stock variant into the sentence. Split it.
        "Unlike Zeto_AnonNullifier, the non-repudiation authority can see sender, receivers and amounts.",
      ],
      good: [
        "No issuer can decrypt a balance on these variants.",
        "An auditor view exists only in the non-repudiation variant (GAP-1).",
        "In Zeto_AnonEncNullifierNonRepudiation the authority can decrypt every input and output of a transfer.",
        "In the deployed nonrepudiation variant, the auditor can decrypt every value.",
        "The non-repudiation authority sees sender, receivers and amounts.",
      ],
    },
  },
  // ---- P-6: shape / timing / frequency
  {
    id: "P-6", name: "hides shape/timing/metadata/everything",
    pattern: /\bhid(?:es?|ing|den)\s+(?:the\s+)?(?:transaction\s+)?(?:shape|timing|frequency|metadata|everything|all\s+metadata)\b/i,
    negatable: NEG,
    why: "timing, gas and note count are public (E-6, P-6)",
    samples: { bad: ["It hides everything."], good: ["It does not hide timing."] },
  },
  {
    id: "P-6", name: "complete privacy", pattern: /\b(?:fully|completely|totally|perfectly)\s+(?:private|confidential|hidden)\b|\b(?:complete|full|total|perfect)\s+(?:privacy|confidentiality|anonymity)\b/i,
    negatable: NEG,
    why: "see E-6, F-1",
    samples: { bad: ["Desks get complete privacy."], good: ["This is not complete privacy."] },
  },
  {
    id: "P-6", name: "no leaks", pattern: /\b(?:no\s+(?:metadata\s+)?leaks?|leaks?\s+nothing|zero[- ]leak(?:age)?)\b/i, negatable: false,
    why: "the leak surface is measured and non-empty (E-6, F-1)",
    samples: { bad: ["There are no leaks."], good: ["The leaks are listed in §4."] },
  },
  // ---- P-7: auditor key fixed
  {
    id: "P-7", name: "auditor key fixed", pattern: /\b(?:auditor|arbiter|authority)\s+key\s+is\s+(?:fixed|immutable|permanent|set at deploy)|\bimmutable\s+(?:auditor|arbiter)\b/i,
    negatable: NEG,
    why: "setArbiter is onlyOwner, rotatable anytime, no event or timelock (E-4, P-7)",
    samples: { bad: ["The auditor key is fixed at deploy time."], good: ["The auditor key is not fixed: setArbiter rotates it."] },
  },
  // ---- P-8: numbers without method; a single nullifier-transfer gas figure
  {
    id: "P-8", name: "single gas figure for a nullifier transfer", pattern: /$^/, negatable: false,
    detect: (t, c) =>
      gasFigures(t).length === 1 && /nullifier/i.test(c) && /\bgas/i.test(c) && /transfer/i.test(c) &&
      !/data[- ]dependent|\brange\b|observed in this run/i.test(c),
    why: "nullifier-transfer gas is data-dependent (1.38 M–2.31 M observed, E-10): quote the range, never one number",
    samples: {
      bad: ["An AnonNullifier transfer costs 1,381,377 gas.", "A nullifier transfer uses 1.38 M gas.", "| AnonNullifier transfer gas | 1,381,377 |",
        "An AnonNullifier transfer costs 3,500,000 gas.", "A nullifier transfer costs 900 k gas."],
      good: ["AnonNullifier transfer gas was 1.38 M–1.72 M across runs (E-10).", "This AnonNullifier transfer used 1,715,535 gas, observed in this run (data-dependent, E-10)."],
    },
  },
  {
    id: "P-8", name: "nullifier proving time", pattern: /$^/, negatable: false,
    detect: (t, c) => /\b\d+(?:\.\d+)?\s?(?:ms|s|seconds)\b/i.test(t) && /nullifier/i.test(c) && /\bprov(e|es|ing)\b/i.test(c) && !/GAP-2|not measured|\bB-2\b/i.test(c),
    why: "nullifier-variant proving time was not measured (GAP-2, B-2)",
    samples: { bad: ["Nullifier proving takes 900 ms."], good: ["Nullifier proving time is not measured (GAP-2)."] },
  },
  {
    id: "P-8", name: "timing without hardware", pattern: /$^/, negatable: false,
    detect: (t, c) => /\b\d+(?:\.\d+)?\s?ms\b/i.test(t) && /\b(prov|latency|witness)/i.test(c) && !/M3|hardware|machine|\bE-9\b|GAP-2|not measured|POLL_MS|poll/i.test(c),
    why: "a latency number needs hardware, tool version and method (P-8, E-9)",
    samples: {
      bad: ["Proving takes 326 ms.", "| Proving latency | 326 ms |"],
      good: ["anon proving median 326 ms on an Apple M3 Pro (E-9).", "| Proving latency (M3 Pro) | 326 ms |"],
    },
  },
  // ---- P-9: trusted setup
  {
    id: "P-9", name: "no trusted setup",
    pattern: /\b(?:no|without(?:\s+a)?|needs\s+no|doesn'?t\s+need(?:\s+a)?|free\s+of(?:\s+a)?)\s+trusted[- ]setup\b|\btrusted[- ]setup[- ]free\b|\btransparent\s+setup\b|\b(?:needs|requires)\s+no\s+(?:setup\s+)?ceremony\b|\bno\s+(?:setup\s+)?ceremony\s+(?:is\s+)?(?:needed|required)\b/i,
    negatable: false,
    allowIf: /XLS-96|Bulletproof/i,
    why: "Zeto is Groth16, one trusted setup per circuit (E-5, P-9)",
    samples: {
      bad: ["Zeto needs no trusted setup.", "Zeto requires no ceremony."],
      good: ["XLS-96 needs no trusted setup (Bulletproofs); Zeto does.", "Paladin ships the test keys and documents no ceremony."],
    },
  },
  // ---- P-10: the node
  {
    id: "P-10", name: "neutral relay", pattern: /\bneutral\s+(?:relay|party|intermediary)\b|\b(?:survives?|tolerates?|robust to)\s+(?:a\s+)?(?:node|operator)\s+compromise\b/i,
    negatable: NEG,
    why: "the node holds keys, proves, stores plaintext; compromise = read all + spend all (E-8, P-10)",
    samples: { bad: ["The Paladin node is a neutral relay."], good: ["The Paladin node is not a neutral relay."] },
  },
  {
    id: "P-10", name: "node cannot see", pattern: /\b(?:node|operator)s?\s+(?:cannot|can(?:no|')t|never|does not|doesn't)\s+(?:see|read|access|spend|learn)\b/i,
    negatable: false,
    allowIf: /\bcounterparty\b|\bother node|\bnon-?party\b|\bobserver\b/i,
    why: "the sender's node sees all its tenants' plaintext (E-8)",
    samples: { bad: ["The node cannot see your amounts."], good: ["A non-party node cannot see the amount; the sender's own node can (E-8)."] },
  },
  // ---- P-11: negative claims need the search
  {
    id: "P-11", name: "negative existence claim",
    pattern: /\bno\s+(?:public\s+|third-party\s+|security\s+)?audits?\s+(?:exists?|has been|was|were)\b|\bhas never been audited\b|\bdoes(?:\s+not|n't)\s+exist\b|\bnowhere in\b/i,
    negatable: false,
    allowIf: /\bfound\b|\bsearch|\bcorpus\b|\bgrep\b|\bE-11\b|audit-search/i,
    why: "a negative needs its falsifying search recorded alongside (P-11, E-11)",
    samples: { bad: ["No audit exists for Zeto."], good: ["No audit was found in the searched corpus (E-11)."] },
  },
  // ---- P-12: attribution
  {
    id: "P-12", name: "original research", pattern: /\boriginal research\b|\bwe (?:discovered|were first)\b|\bnovel (?:finding|attack|vulnerability)\b|\bfirst to (?:find|discover|show)\b/i,
    negatable: NEG,
    why: "cite the Zeto maintainers, Qurrency authors and #186's reporter (P-12)",
    samples: { bad: ["This is original research."], good: ["This is not original research; it cites Zeto #186."] },
  },
  // ---- F-2 containment: pending private disclosure
  // No `only`: F-2 specifics must not appear in ANY scoped file (step 3, 2026-09-27). The one
  // permitted home is the register and the source note, which the scan never reads
  // (EXEMPT_FILES: CLAIMS.md; EXEMPT_PREFIXES: docs/task-zero/sources/). The public repo redacts
  // even those, and private/make-public.sh greps the whole exported tree as a second guard.
  {
    id: "F-2", name: "F-2 specifics outside the register",
    pattern: /\bwithheld-finding-marker\b/i, negatable: false, // real F-2 vocabulary restored on disclosure
    why: "F-2 is pending private disclosure to Paladin/Zeto; its specifics stay in CLAIMS.md and the exempt source note only, never in a scoped file",
    samples: { bad: ["A sentence with the withheld-finding-marker token."], good: ["The note count leaks through zero padding."] },
  },
];

// ---------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------

export interface Hit {
  file: string;
  line: number;
  rule: string; // "P-1 trustless"
  text: string;
  why: string;
}
export interface Waiver {
  file: string;
  line: number;
  rule: string;
  reason: string;
}

const WAIVER = /disclosure-ok\(([PEFB]-\d+)\)\s*:?\s*([^\n*>]*)/g;

function waiverFor(u: Unit, id: string): string | null {
  for (const src of [u.text, u.prevLine]) {
    for (const m of src.matchAll(WAIVER)) if (m[1] === id && m[2].trim().length >= 8) return m[2].trim();
  }
  return null;
}

function isCode(file: string): boolean {
  return /\.(ts|tsx|js|mjs)$/.test(file);
}

function inScope(rule: Rule, file: string): boolean {
  return !rule.only || rule.only.some((p) => file === p || file.startsWith(p));
}

/** The REAL detector. Every control and the CLI call this. */
export function scanText(file: string, text: string, rules: Rule[] = RULES): { hits: Hit[]; waivers: Waiver[] } {
  const hits: Hit[] = [];
  const waivers: Waiver[] = [];
  for (const u of units(text, isCode(file))) {
    for (const r of rules) {
      if (!inScope(r, file)) continue;
      let fired: boolean;
      if (r.detect) {
        fired = r.detect(u.text, u.context);
      } else {
        // Every occurrence is judged on its own: one negated use must not forgive another.
        const re = new RegExp(r.pattern.source, r.pattern.flags.includes("g") ? r.pattern.flags : r.pattern.flags + "g");
        const idxs = [...u.text.matchAll(re)].map((m) => m.index ?? 0);
        fired = r.negatable ? idxs.some((i) => !negatedBefore(u.text, i)) : idxs.length > 0;
      }
      if (!fired) continue;
      // A short question ("**Audited?**", a table header) asserts nothing.
      if (r.negatable && /\?\**\s*$/.test(u.text) && u.text.length <= 60) continue;
      if (r.allowIf && (typeof r.allowIf === "function" ? r.allowIf(u.context) : r.allowIf.test(u.context))) continue;
      const w = waiverFor(u, r.id);
      if (w) {
        waivers.push({ file, line: u.line, rule: `${r.id} ${r.name}`, reason: w });
        continue;
      }
      hits.push({ file, line: u.line, rule: `${r.id} ${r.name}`, text: u.text.slice(0, 160), why: r.why });
    }
  }
  return { hits, waivers };
}

// ---- citations -------------------------------------------------------------

export function claimsRows(claimsText: string): Map<string, string> {
  // id -> section status ("prohibition" | "established" | "pending" | "finding" | "retracted")
  const rows = new Map<string, string>();
  let section = "";
  for (const line of claimsText.split("\n")) {
    const h = /^##\s+(.*)/.exec(line);
    if (h) section = h[1].toLowerCase();
    const m = /^\|\s*([PEFB]-\d+)\s*\|/.exec(line);
    if (m) {
      const kind = section.startsWith("standing") ? "prohibition" : section.startsWith("established") ? "established"
        : section.startsWith("pending") ? "pending" : section.startsWith("findings") ? "finding" : section.startsWith("retracted") ? "retracted" : "other";
      rows.set(m[1], kind);
    }
  }
  return rows;
}

/**
 * True if the id at `index` is attributed to the reference (XLS-96) project's register,
 * a different namespace: "(ref P-10)", "(ref E-4, §6)", "the reference project's F-1",
 * "XLS-96 F-1", "its P-12". Only that id is exempt, not the whole sentence.
 */
function referenceAttributed(unit: string, index: number): boolean {
  for (const m of unit.matchAll(/\(ref\b[^)]*\)/gi)) {
    if (index >= (m.index ?? 0) && index < (m.index ?? 0) + m[0].length) return true;
  }
  const before = unit.slice(Math.max(0, index - 40), index);
  return /(?:\bref\.?|\breference(?:\s+project)?(?:'s)?|\bXLS-96(?:'s)?|\bxrpl\S*|\bits)\s+$/i.test(before);
}

/** The clause around `index`, for binding a "pending" qualifier to one cited id. */
function clauseAt(unit: string, index: number): string {
  const delim = /[;.—]|\s(?:while|but|whereas|although)\s/gi;
  let start = 0;
  let end = unit.length;
  for (const m of unit.matchAll(delim)) {
    const i = m.index ?? 0;
    if (i < index) start = i + m[0].length;
    else if (i > index) {
      end = i;
      break;
    }
  }
  return unit.slice(start, end);
}

export function scanCitations(file: string, text: string, rows: Map<string, string>): Hit[] {
  const hits: Hit[] = [];
  for (const u of units(text, isCode(file))) {
    for (const m of u.text.matchAll(/(?<![\w-])([PEFB])-(\d+)\b/g)) {
      const at = m.index ?? 0;
      if (referenceAttributed(u.text, at)) continue;
      const id = `${m[1]}-${m[2]}`;
      const kind = rows.get(id);
      if (!kind) {
        hits.push({ file, line: u.line, rule: "CITE unknown row", text: u.text.slice(0, 160), why: `${id} is not a row in CLAIMS.md` });
      } else if (kind === "pending" && !/pending|not (?:yet )?(?:measured|run|executed|demonstrated|established)|\bGAP\b|needs/i.test(clauseAt(u.text, at))) {
        hits.push({ file, line: u.line, rule: "CITE pending row as support", text: u.text.slice(0, 160),
          why: `${id} is PENDING in CLAIMS.md and may not be published as established; say it is pending/unmeasured in the same clause` });
      }
    }
  }
  return hits;
}

// ---- required disclosures ---------------------------------------------------

export interface Requirement {
  file: string | RegExp;
  must: RegExp;
  what: string;
  /** A minimal text that satisfies `must` (the control checks it passes and "" fails). */
  pass: string;
}
export const REQUIRED: Requirement[] = [
  { file: "README.md", must: /UNSAFE/, what: "say the shipped Groth16 keys are UNSAFE test keys (E-5)", pass: "The keys are UNSAFE test keys." },
  // Step 3 (2026-09-27): the rebuilt README's honesty sections are load-bearing; dropping one fails.
  { file: "README.md", must: /^#+\s.*NOT hidden/im, what: "carry a 'What is NOT hidden' section", pass: "## What is NOT hidden\n" },
  { file: "README.md", must: /^#+\s.*open gaps/im, what: "carry an 'Open gaps' section listing GAPS-2026-09-26.md", pass: "## Open gaps\n" },
  { file: "README.md", must: /^#+\s.*trust model/im, what: "carry a 'Trust model' section (node, owner, authority)", pass: "## Trust model\n" },
  { file: "README.md", must: /<!-- counts:begin[^]*?<!-- counts:end -->/, what: "carry the generated counts block (tools/counts.ts), not hand-typed counts", pass: "<!-- counts:begin x -->\n<!-- counts:end -->" },
  { file: "example/README.md", must: /UNSAFE/, what: "say the shipped Groth16 keys are UNSAFE test keys (E-5)", pass: "UNSAFE test keys." },
  { file: "example/README.md", must: /^#+\s.*NOT hidden/im, what: "carry a 'what is NOT hidden' section", pass: "## What is NOT hidden\n" },
  { file: "example/README.md", must: /^#+\s.*NOT demonstrated/im, what: "carry a 'what is NOT demonstrated' section", pass: "## What is NOT demonstrated\n" },
  { file: /^example\/out\/.*\.log$/, must: /UNSAFE/, what: "print the UNSAFE-keys banner in the recorded transcript", pass: "UNSAFE test keys" },
];

export function scanRequired(files: Map<string, string>, reqs: Requirement[] = REQUIRED): Hit[] {
  const hits: Hit[] = [];
  for (const r of reqs) {
    const matching = [...files.keys()].filter((f) => (typeof r.file === "string" ? f === r.file : r.file.test(f)));
    if (typeof r.file === "string" && matching.length === 0) {
      // A named file is required once its directory exists.
      const dir = r.file.includes("/") ? r.file.slice(0, r.file.lastIndexOf("/")) : ".";
      if (existsSync(join(ROOT, dir))) {
        hits.push({ file: r.file, line: 0, rule: "REQUIRED file missing", text: "", why: `${r.file} must exist and ${r.what}` });
      }
      continue;
    }
    for (const f of matching) {
      if (!r.must.test(files.get(f) ?? "")) hits.push({ file: f, line: 0, rule: "REQUIRED disclosure missing", text: "", why: `must ${r.what}` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runControls(rows: Map<string, string>): string[] {
  const failures: string[] = [];
  const caught = (file: string, text: string, rule: Rule) => scanText(file, text, [rule]).hits.length > 0;
  for (const r of RULES) {
    const file = r.only ? `${r.only[0].replace(/\/$/, "")}${r.only[0].endsWith("/") ? "/control.md" : ""}` : "control.md";
    if (r.samples.bad.length === 0 || r.samples.good.length === 0) failures.push(`${r.id} ${r.name}: needs at least one bad and one good sample`);
    for (const s of r.samples.bad) if (!caught(file, s, r)) failures.push(`${r.id} ${r.name}: bad sample NOT caught: "${s}"`);
    for (const s of r.samples.good) if (caught(file, s, r)) failures.push(`${r.id} ${r.name}: good sample wrongly caught: "${s}"`);
    // A waiver with the right id forgives; one with the wrong id does not.
    const bad = r.samples.bad[0];
    if (caught(file, `${bad} <!-- disclosure-ok(${r.id}): control sample, reviewed -->`, r)) failures.push(`${r.id} ${r.name}: a matching waiver did not forgive`);
    const wrong = r.id === "P-1" ? "P-2" : "P-1";
    if (!caught(file, `${bad} <!-- disclosure-ok(${wrong}): wrong row id -->`, r)) failures.push(`${r.id} ${r.name}: a waiver for the wrong row forgave`);
  }
  // Scope: F-2 containment now fires in EVERY scoped file (README, docs, example), so its
  // specifics cannot leak into a normal doc. The only home is the exempt register / source note,
  // which the real scan never reads.
  const f2 = RULES.find((r) => r.id === "F-2")!;
  for (const f of ["docs/x.md", "example/x.md", "README.md", "tools/observer/README.md"]) {
    if (!scanText(f, f2.samples.bad[0], [f2]).hits.length) failures.push(`F-2 rule no longer fires in ${f}`);
  }
  if (scanText("c.md", f2.samples.good[0], [f2]).hits.length) failures.push("F-2 rule wrongly fired on its good sample");
  // Units: a negator in one bullet must not forgive the next bullet.
  if (!scanText("c.md", "- Nothing here is slow.\n- It is production-ready.\n").hits.length) failures.push("a negator leaked across list items");
  // Prefixed continuations: a wrapped blockquote/comment sentence keeps its negator.
  if (scanText("c.md", "> Nothing here is secure, audited,\n> non-custodial or production-ready.\n").hits.length) failures.push("a wrapped blockquote lost its negator");
  if (scanText("c.ts", "// Nothing here is audited or\n// production-ready.\n").hits.length) failures.push("a wrapped // comment lost its negator");
  if (!scanText("c.md", "> Nothing is slow.\n\n> It is production-ready.\n").hits.length) failures.push("a negator leaked across blockquote paragraphs");
  // Required disclosures: each requirement fails on an empty file and passes on its sample.
  for (const r of REQUIRED) {
    const f = typeof r.file === "string" ? r.file : "example/out/control.log";
    if (typeof r.file !== "string" && !r.file.test(f)) failures.push(`REQUIRED "${r.what}": control file name does not match its pattern`);
    if (!scanRequired(new Map([[f, ""]]), [r]).length) failures.push(`REQUIRED "${r.what}": an empty ${f} was not caught`);
    if (scanRequired(new Map([[f, r.pass]]), [r]).length) failures.push(`REQUIRED "${r.what}": its passing sample was wrongly caught`);
  }
  // Citations.
  if (!scanCitations("c.md", "See E-9999.", rows).length) failures.push("an unknown row id was not caught");
  if (scanCitations("c.md", "See E-10.", rows).length) failures.push("a known row id was wrongly caught");
  if (!scanCitations("c.md", "XLS-96 differs; see E-9999.", rows).length) failures.push("a comparison sentence hid an unknown local row");
  if (scanCitations("c.md", "XLS-96 has no key rotation (ref P-99, E-98).", rows).length) failures.push("a reference-attributed id was wrongly caught");
  const pending = [...rows].find(([, k]) => k === "pending")?.[0];
  if (pending) {
    if (!scanCitations("c.md", `Latency is 2 s (${pending}).`, rows).length) failures.push("a pending row cited as support was not caught");
    if (scanCitations("c.md", `Latency is not measured (${pending}).`, rows).length) failures.push("a pending row cited as pending was wrongly caught");
    const other = [...rows].filter(([, k]) => k === "pending").map(([id]) => id).find((id) => id !== pending);
    if (other && !scanCitations("c.md", `Latency is 3 s (${pending}), while ${other} is pending.`, rows).length) failures.push("one pending qualifier forgave a different pending row");
  } else failures.push("CLAIMS.md has no pending row to exercise the control");
  return failures;
}

function main(): void {
  const claimsPath = join(ROOT, "CLAIMS.md");
  if (!existsSync(claimsPath)) {
    console.log("FAIL: CLAIMS.md not found — the gate has nothing to check against");
    process.exit(1);
  }
  if (RULES.length === 0) {
    console.log("FAIL: the rule list is empty — this gate would assert nothing");
    process.exit(1);
  }
  const rows = claimsRows(readFileSync(claimsPath, "utf8"));
  const prohibitions = [...rows].filter(([, k]) => k === "prohibition").map(([id]) => id);
  const uncovered = prohibitions.filter((id) => !RULES.some((r) => r.id === id));

  const files = new Map<string, string>();
  for (const f of liveFiles()) files.set(f, readFileSync(join(ROOT, f), "utf8"));
  const extra = process.env.DISCLOSURE_EXTRA;
  if (extra) {
    const as = process.env.DISCLOSURE_EXTRA_AS || basename(extra);
    files.set(as, readFileSync(extra, "utf8"));
  }

  console.log("check-disclosure — no user-facing file may claim more than CLAIMS.md supports");
  console.log(`  ${files.size} files, ${RULES.length} rules over ${new Set(RULES.map((r) => r.id)).size} CLAIMS rows, ${rows.size} rows in the register\n`);

  const hits: Hit[] = [];
  const waivers: Waiver[] = [];
  for (const [f, text] of files) {
    const r = scanText(f, text);
    hits.push(...r.hits);
    waivers.push(...r.waivers);
    hits.push(...scanCitations(f, text, rows));
  }
  hits.push(...scanRequired(files));

  for (const h of hits) {
    console.log(`  ✗ ${h.file}:${h.line}  [${h.rule}]`);
    if (h.text) console.log(`      "${h.text}"`);
    console.log(`      ${h.why}`);
  }
  if (!hits.length) console.log("  ✓ no overclaim found");

  if (waivers.length) {
    console.log(`\nWaivers (${waivers.length}) — each is a reviewed decision; re-read them when CLAIMS.md changes:`);
    for (const w of waivers) console.log(`  ~ ${w.file}:${w.line}  [${w.rule}]  ${w.reason}`);
  }

  console.log("\nControls — through the same detector the scan uses");
  const cf = runControls(rows);
  if (uncovered.length) cf.push(`standing prohibitions with no rule: ${uncovered.join(", ")}`);
  for (const c of cf) console.log(`  ✗ ${c}`);
  if (!cf.length) console.log(`  ✓ ${RULES.length} rules × (bad caught, good passed, waiver scoped) + ${REQUIRED.length} required disclosures × (empty caught, sample passed) + scope/unit/citation controls; P-1..P-${prohibitions.length} all covered`);

  console.log("\n" + "-".repeat(74));
  if (hits.length || cf.length) {
    console.log(`FAIL: ${hits.length} overclaim(s), ${cf.length} control failure(s).`);
    process.exit(1);
  }
  console.log(`PASS: ${files.size} files, 0 overclaims, ${waivers.length} waiver(s).`);
  console.log("LEXICAL: it catches phrasings, not meanings, and cannot tell whether a claim is true.");
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") main();
