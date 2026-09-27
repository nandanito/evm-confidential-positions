# Search log: published security audits of Zeto and Paladin (LFDT-Paladin)

- Date of all searches: 2026-09-26
- Targets: Zeto (github.com/LFDT-Paladin/zeto, formerly hyperledger-labs/zeto) and Paladin (github.com/LFDT-Paladin/paladin, formerly LF-Decentralized-Trust-labs/paladin, kaleido-io/paladin). Maintainer: Kaleido / LF Decentralized Trust.
- Local clones: `scratchpad/src/zeto` @ dd495492f540 (2026-09-17), `scratchpad/src/paladin` @ ca552a656 (2026-09-24).
- Audit-firm repo clones: `scratchpad/corpus/*` (depth-1, commits listed below).
- Name-collision warning: "Paladin" also names (a) Paladin Blockchain Security, an audit firm (paladinsec.co), and (b) PaladinFinance / paladin.vote, a DeFi protocol. Hits for those are NOT about the LFDT project and are marked as such.

## Conclusion

**No third-party security audit report for Zeto or LFDT Paladin was found in any corpus searched below.** This means only that no report turned up in these corpora. It does not show that no audit took place: private or unpublished audits would not appear. The gaps are listed at the end.

Related items that are not audits:
1. **Academic formal modelling that touches Zeto's security**: IACR ePrint 2026/015, "Qurrency: a quantum-secure, private, and auditable platform for digital assets" (Choudhuri, Garg, Gregoire, Lee, Lodder, Montgomery, Policharla, Zhang; Jan 2026). Quote: "our model is loosely based upon the open source software that we found came the closest to meeting our requirements, Linux Foundation Decentralized Trust (LFDT) Zeto. In the course of our formal modeling, we helped to improve the security of Zeto." Also: "Prior to the enhancements described in this work, it did not provide quantum privacy, and there were no formal models or security proofs for most tokens in the Zeto system." The paper does not say which security improvements were made. It is not an audit report. https://eprint.iacr.org/2026/015
2. **Public security issue, Zeto #186** (arjtriv, 2026-04-05, OPEN): "All 20 Groth16 verifiers use insecure delta (no Phase 2 ceremony)". Maintainer reply (jimthematrix, 2026-08-03): "We consider the current warning 'sufficient' because once you add contribution steps to the setup ceremony, the constants in the verification key are updated such that the existing verifier library can no longer verify proofs..." https://github.com/LFDT-Paladin/zeto/issues/186
3. **Community-reported under-constraint issue, Zeto #92 → PR #95** (yushihang, 2024-10-09): `CheckSum()` used `assert()` rather than constraints. Fixed in PR #95, "ensure constraints are applied appropriately" (merged Oct 2024). https://github.com/LFDT-Paladin/zeto/issues/92 , https://github.com/LFDT-Paladin/zeto/pull/95
4. **Self-disclosed flaw in Paladin, PR #1309** (jimthematrix, 2026-07-30): "Fixes a potentially exploitable flaw in the `NotoNullifiers` variant where a coin's nullifier was derived from `(amount, salt)` only..." This concerns the Noto domain, not Zeto. https://github.com/LFDT-Paladin/paladin/pull/1309
5. **Zeto PR #41** (2024-08-16): "Fix withdraw() methods in nullifier contracts for not validating the root". This was an internal fix.
6. **Downstream forks with security notes** (not audits):
   - Reccetech/zeto-hiero `docs/upstream-contributions.md` lists an unfiled low-severity bug: the `Registry._register` duplicate check looks up `poseidon2(publicKey)` but inserts under a `poseidon3` key. Its `sdk/README.md` states the fork "has **not been through a third-party security audit**". That statement is about the fork, not upstream. https://github.com/Reccetech/zeto-hiero
   - fractalyze/bongtu `docs/security-model.md` (public) documents circuit hardening in its Zeto fork and states the fork has **not** had a third-party audit. That statement is about the fork, not upstream. https://github.com/fractalyze/bongtu
7. **Zeto README warning** (line ~28): "**Warning:** We provide a testing framework for Zeto tokens, which initializes the zero-knowledge proof infrastructure locally..." The warning says this local setup is not sufficient to establish trust. It is not audit-related.
8. **OpenSSF Best Practices entry** "LFDT-Paladin": badge progress 6%, not passing (https://www.bestpractices.dev/en/projects?q=paladin). No entry for Zeto.

## Full search log

### A. Local repositories (grep)

| # | Command / action | Result |
|---|---|---|
| A1 | `find . -iname '*audit*'` (excl. node_modules, .git) in zeto and paladin | 0 files in either repo; no `audits/` directory |
| A2 | `find . -iname 'SECURITY*'` | zeto: `SECURITY.md` (redirects to the Paladin policy). paladin: none in repo (policy lives in the org `.github` repo, see B3) |
| A3 | `grep -rniE 'audit\|trail of bits\|trailofbits\|zellic\|veridise\|least authority\|leastauthority\|openzeppelin audit\|security review\|formal verification\|picus\|circomspect\|ecne\|zksecurity\|spearbit\|cantina\|hacken\|consensys diligence\|nethermind\|ostif'` (excl. node_modules/.git/lockfiles) | zeto: 33 lines, all about the "auditing authority" feature (Qurrency/non-repudiation). paladin: 13 lines (a BIP39 mnemonic word "audit", "auditable" in tutorials, `npm audit`). **No audit-firm or security-review hits** |
| A4 | `git log --all -i --grep=audit --grep='security review' --grep=zellic --grep='trail of bits' --grep=veridise` | zeto (979 commits): 4 commits, all about the Qurrency auditor feature. paladin (7188 commits): 1 commit, "Ran npm audit fix". No audit reports |
| A5 | `grep -rniE 'production\|not (been )?audited\|use at your own risk\|experimental'` in READMEs/docs | No "unaudited"/"audited" disclaimer found. The only warning is the trusted-setup one (item 7 above) |

### B. GitHub API / gh CLI

| # | Command | Result |
|---|---|---|
| B1 | `gh api repos/LFDT-Paladin/zeto/security-advisories` | `[]` (0 published advisories) |
| B2 | `gh api repos/LFDT-Paladin/paladin/security-advisories` | `[]` (0 published advisories) |
| B3 | `gh api repos/LFDT-Paladin/paladin/contents/SECURITY.md` → 404; `gh api repos/LFDT-Paladin/.github/contents/SECURITY.md` | Org-level SECURITY.md: a vulnerability-disclosure policy (security team: Matthew Whitehead, "Paladin & Zeto"; the other slots say TBC). **No mention of audits** |
| B4 | `gh search issues "<q>" --repo LFDT-Paladin/zeto --include-prs` for q = `audit`, `security review`, `vulnerability`, `soundness`, `underconstrained`, `under-constrained`, `security`, `exploit`, `forge`, `trusted setup` | audit: #133, #148, #132, #129 (all about the Qurrency auditor feature). vulnerability: #186, #201, #95. soundness: #186. security: dependabot bumps, #172 (SECURITY.md), #41, etc. exploit/forge: #186, #94. trusted setup: #186, #136, #50. security review / underconstrained / under-constrained: 0. **No audit report** |
| B5 | Same queries on `--repo LFDT-Paladin/paladin` | audit: #928, #749 ("Fix CVEs"), #672. vulnerability: #1369, #893, #1309, #642. security: #893, #484 (CVE bump), others unrelated. exploit: #1309 plus unrelated. security review / soundness / underconstrained / forge / trusted setup: 0. **No audit report** |
| B6 | `gh search repos` for `"zeto audit"`, `"zeto circuits"`, `"paladin kaleido audit"`, `"zeto zkp"`, `"hyperledger zeto"` | 0 results each |
| B7 | `gh search repos "zeto"`, `"zeto in:readme zero knowledge"`, `"paladin in:name kaleido"` | Found only the project repos and forks/apps (settlemint/solidity-zeto, ashleshsortee/zeto-*, FluxAstromeshLabs/zeto). No audit repos |
| B8 | `gh search issues` (global) for `"hyperledger-labs/zeto audit"`, `"LFDT-Paladin/zeto audit"`, `"zeto circom underconstrained"` | 0 results |
| B9 | `gh search code "zeto" --owner <org>` and `"kaleido paladin" --owner <org>` for trailofbits, Zellic, Veridise, zksecurity, spearbit | Only tokenizer noise (lockfiles, highlighter source, trailofbits/multiplier symex). No Zeto/Paladin reports |
| B10 | Same for cantina-xyz, NethermindEth, Consensys, OpenZeppelin, leastauthority, hacken, ostif-org, 0xPARC | **FAILED: HTTP 403 rate limit (GAP)**. Partly covered by C and D below |
| B11 | `gh search code hyperledger-labs/zeto` and `gh search code LFDT-Paladin/zeto` (global, first 30 results each) | The project's own repos, LFDT labs site, LFDT-way activity reports, fractalyze/bongtu, Reccetech/zeto-hiero, kaleido-io/PET-atomic-settlements, lamtrinh259/ETH_Tokyo_2024. None are audit reports (see Conclusion item 6) |
| B12 | `gh search code '"zeto" audit report'`, `'"zeto" underconstrained'`, `'"LFDT-Paladin/paladin"'` (filtered for non-project repos) | 0 non-project results |

### C. Audit-firm publication repos (depth-1 git clones; grep of file paths, plus content/README index where checked out)

| # | Repo (commit) | Files | Path grep `zeto\|paladin\|kaleido\|hyperledger\|lfdt\|decentralized trust` | Content / README grep |
|---|---|---|---|---|
| C1 | trailofbits/publications (c9aabf2) | 958 | 0 | README index (1317 lines): 0. Full content checkout partly failed on filenames with spaces |
| C2 | Zellic/publications (9d42b59) | 408 | 0 | README (443 lines): 0; content grep of checked-out text: 0 |
| C3 | spearbit/portfolio (fd3f344) | 16 | 0 | README: 2 hits, both "Paladin (https://paladin.vote/)", a DeFi protocol (Apr and Nov 2022). **Unrelated name collision** |
| C4 | Cyfrin/cyfrin-audit-reports (f8ce1a7) | 403 | 1: `2025-03-12-cyfrin-paladin-valkyrie-v2.0` | Report targets `github.com/PaladinFinance/Valkyrie`. **Unrelated name collision** |
| C5 | nethermindeth/PublicAuditReports (399b28a) | 191 | 0 | not checked out |
| C6 | sherlock-protocol/sherlock-reports (04896ff) | 306 | 0 | not checked out |
| C7 | pashov/audits (f70db02) | 610 | 0 | not checked out |
| C8 | HalbornSecurity/PublicReports (4f3d1c6) | 295 | 0 | not checked out |
| C9 | OpenZeppelin/openzeppelin-contracts (4858ab1) | 964 | 0 | Contains only OZ's own audits, so it is not a useful corpus |
| C10 | Veridise/audits | **FAILED: repo does not exist (GAP)**. Covered by D2 |
| C11 | zksecurity/zkbugs (a0eed74, full clone) | 44 bug dirs | 0 | Content grep: 0. Project list (0xbok … zkopru-network) contains no zeto/kaleido/LFDT |
| C12 | 0xPARC/zk-bug-tracker (56a9966) | README 2123 lines | 0 | README grep: 0 |

### D. Web: audit-firm listing pages (WebFetch)

| # | URL | Result |
|---|---|---|
| D1 | https://veridise.com/audits/ | Landing page with no list. Points to the archive |
| D2 | https://veridise.com/audits-archive/ | About 280-290 entries (May 2022 to Jun 2026). No Zeto/Paladin/Kaleido/LFDT/Hyperledger |
| D3 | https://leastauthority.com/security-consulting/published-audits/ | About 90-100+ published audits (2014-2026). No hits |
| D4 | https://www.openzeppelin.com/security-audits | Curated highlights only, not exhaustive. No hits. **Partial coverage (GAP)** |
| D5 | https://reports.zksecurity.xyz/ | 63 reports listed. No hits |
| D6 | https://diligence.consensys.io/audits/ → 301 → https://diligence.security/audits/ | **FAILED: HTTP 403 (GAP)**. Fallback web search (E9): no hits |
| D7 | https://cantina.xyz/portfolio | About 200+ entries, but only back to Oct 2025. No hits. **Partial coverage (GAP)** |
| D8 | https://www.nethermind.io/smart-contract-audits | Only about 6 featured reports shown. No hits. **Partial (GAP)**. C5 covers the GitHub repo |
| D9 | https://hacken.io/audits/ | **FAILED: HTTP 403 (GAP)**. Fallback web search `site:hacken.io Paladin Kaleido OR Zeto`: no hacken.io results |
| D10 | https://www.zellic.io/audits/ | **FAILED: HTTP 404 (GAP)**. C2 covers the GitHub repo |
| D11 | https://ostif.org/audits/ | About 110 projects listed. No Paladin/Zeto/Kaleido/Hyperledger/LFDT |

### E. Web: general / project / vendor / LFDT (WebSearch, WebFetch)

| # | Query / URL | Result |
|---|---|---|
| E1 | WebSearch `Zeto zero knowledge token toolkit security audit` | Project pages, a class-central video, the FluxAstromeshLabs fork, generic ZK-audit vendors. No audit |
| E2 | WebSearch `Paladin Kaleido privacy EVM security audit report` | Kaleido/LFDT pages, paladinsec.co (the audit firm, a name collision). No audit |
| E3 | WebSearch `"zeto" circom circuits audit Kaleido` | fractalyze/bongtu, Kaleido resource page, generic Circom material. No audit |
| E4 | WebSearch `"LFDT-Paladin" OR "hyperledger-labs/zeto" audit` | Project pages only. No audit |
| E5 | WebSearch `Kaleido Paladin Zeto "audited" OR "security assessment" OR "penetration test"` | Kaleido ISO 27001/SOC2 (company ops), unrelated pentest firms. No audit |
| E6 | WebSearch `OSTIF audit LF Decentralized Trust Paladin` (the tool ran follow-up queries) | No OSTIF audit of LFDT Paladin. Hits for Paladin Blockchain Security audits of other projects (name collision) |
| E7 | WebSearch `site:hacken.io Paladin Kaleido OR Zeto` | No hacken.io results |
| E8 | WebSearch `site:diligence.security OR site:consensys.io/diligence Zeto OR Kaleido OR "Paladin privacy"` | Unrelated Diligence pages only |
| E9 | WebSearch `site:lfdecentralizedtrust.org Paladin security audit` | Announcements, webinars, slides. No audit |
| E10 | WebSearch `site:kaleido.io Zeto audit security` | Product pages and the security-and-compliance page. No software audit |
| E11 | WebFetch https://www.kaleido.io/zeto | The word "audit" does not appear |
| E12 | WebFetch https://www.kaleido.io/paladin | The word "audit" does not appear |
| E13 | WebFetch https://www.kaleido.io/security-and-compliance | SOC2/ISO certifications only. No code audit of Paladin/Zeto |
| E14 | WebFetch https://www.lfdecentralizedtrust.org/projects/paladin | No audit/assessment/OSTIF/OpenSSF mention |
| E15 | WebFetch https://lfdt-paladin.github.io/zeto/latest/ | No audit/security-review mention |
| E16 | WebFetch https://www.bestpractices.dev/en/projects?q=paladin | "LFDT-Paladin" at 6%. No Zeto entry |
| E17 | WebSearch `Kaleido blog Zeto security review third-party audit circuits` | No Kaleido audit post |
| E18 | WebSearch `"Zeto" Picus OR circomspect OR ecne underconstrained circuits` | Only generic tool pages. No Zeto analysis |

### F. Academic

| # | Query / URL | Result |
|---|---|---|
| F1 | WebSearch `Zeto UTXO privacy tokens arXiv OR eprint.iacr.org zero-knowledge` | ePrint 2026/015 (Qurrency), a **related positive**, see Conclusion item 1 |
| F2 | WebSearch `Qurrency ML-KEM circom Zeto paper` | Same paper |
| F3 | WebFetch https://eprint.iacr.org/search?q=zeto | 1 result: 2026/015 |
| F4 | curl https://eprint.iacr.org/2026/015.pdf, then `pdftotext` and `grep -i zeto` with security terms | Quotes in Conclusion item 1. No list of the specific Zeto security fixes |
| F5 | WebFetch https://export.arxiv.org/api/query?search_query=all:zeto&max_results=50 | 2 results, both unrelated (author "Rene Zeto", photonics) |
| F6 | WebSearch `arxiv "Zeto" privacy-preserving token EVM circuits analysis` | No Zeto-specific paper. arXiv 2501.03391 checked (F7) |
| F7 | WebFetch https://arxiv.org/abs/2501.03391 | The abstract does not mention Zeto/Paladin. Full text not checked (minor gap) |

## Gaps (failed or partial searches, not negatives)

- B10: GitHub code search over cantina-xyz, NethermindEth, Consensys, OpenZeppelin, leastauthority, hacken, ostif-org and 0xPARC orgs hit HTTP 403 (rate limit).
- C1/C3: some filenames with spaces broke the full content checkout for trailofbits/publications and spearbit/portfolio. File paths and README indexes were grepped. PDF bodies were not grepped for any firm.
- C10: Veridise/audits repo does not exist (D2 covers the web archive).
- D4, D7, D8: listing pages were only partial (OpenZeppelin highlights; Cantina only back to Oct 2025; Nethermind featured list).
- D6 (Consensys Diligence) and D9 (Hacken): HTTP 403. D10 (Zellic website): HTTP 404.
- Private or unpublished audits, and audits commissioned by Kaleido customers, cannot be found with public-corpus searches.
- Not searched: Code4rena, Sherlock website, CertiK Skynet, Halborn website, Quantstamp, OtterSec, ChainSecurity, Kudelski, NCC Group public reports.
