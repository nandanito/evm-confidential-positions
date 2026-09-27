# Paladin trust model: primary-source notes

Repo: LFDT-Paladin/paladin at HEAD ca552a65 (2026-09-24). Compared against tag v1.0.0 (2026-06-25); there are 430 commits between them.
All paths are relative to the repo root. Grades: A = two primary sources agree (or code plus doc); B = one primary source; C = inference (stated as such); GAP = could not establish (search recorded).
The following files are **unchanged between v1.0.0 and HEAD**: installation.md, zeto.md, nodes/paladin.yaml, paladindomain_zeto.yaml, signer.go. The diffs in zeto.go, grpc_transport.go, reliable_msg_handler.go, key_management.md and build.gradle are not security-relevant: import renames, `BuildReceipt` implemented, a goroutine-args refactor, a one-line doc tweak and a new goModTidy task. None of the line numbers cited below are shifted by them.

## 1. What the node does in a Zeto transaction

### Proof generation happens in the sender's node (in-process, with the raw private key) [A]
- The Zeto domain builds a Groth16 prover (go-rapidsnark) whenever `snarkProver.circuitsDir` is set:
  - domains/zeto/internal/zeto/zeto.go:186-195
  - domains/zeto/internal/zeto/signer/snark_prover.go:38-40 and :360-361 (`prover.Groth16Prover`)
- `Sign()` receives `privateKey` bytes and builds a BabyJubJub key entry from them (snark_prover.go:113-123).
- The core pushes private keys into the domain:
  - core/go/internal/domainmgr/signer.go:36-40, quoted: "Because private keys are pushed to a domain that enables signing, the config of the node set by the administrator must explicitly enable signing"
  - The domain is registered as the in-memory signer for the `domain:` algorithm prefix (core/go/internal/domainmgr/manager.go:145).
- The docs say the same thing: "a proof generator that is able to use the secrets known only to the Paladin runtime hosting the account key" (doc-site/docs/architecture/zeto.md:18).
- The domain plugin is a c-shared library, `/app/domains/libzeto.so`, with `allowSigning: true` (operator/config/samples/core_v1alpha1_paladindomain_zeto.yaml:11-14).
- The attestation plan contains only an `AttestationType_SIGN` step by the sender, which is the proof. Transfer has no endorsers and `Endorse` returns nil:
  - domains/zeto/internal/zeto/fungible/handler_transfer.go:202-217
  - The same holds for the deposit, withdraw, lock and transferLocked handlers (the grep for `AttestationType_` under domains/zeto/internal finds only `SIGN`).

### Who holds the BabyJubJub keys [A]
The owner's node holds them.
- The key manager derives or loads the key, then passes the 32-byte key to the domain (zeto.go:193-194 registers the algorithm with key length 32).
- The algorithm string is `domain:<name>:snark:babyjubjub` (domains/zeto/pkg/zetosigner/zetosignerapi/zetoalgorithms.go:25-27).
- The same wallet or seed serves every algorithm, because the domain signer is added to each wallet's signing module (core/go/internal/keymanager/manager.go:224-227). **[B/C]** One seed backs both the secp256k1 keys and the BabyJubJub keys.

### Base-ledger submitter [A for the code path; C for the privacy consequence]
- Zeto contract config sets `CoordinatorSelection: COORDINATOR_SENDER` and `SubmitterSelection: SUBMITTER_SENDER` (zeto.go:300-301).
  - The enum is defined at toolkit/proto/protos/to_domain.proto:329-332.
  - Noto uses `SUBMITTER_COORDINATOR` instead (domains/noto/internal/noto/noto.go:771).
- For a normal (SEND) transaction, Zeto `Prepare` sets **no** `RequiredSigner`. It sets `from` only for PREPARE_TRANSACTION intent (handler_transfer.go:271-282).
- The coordinator therefore allocates the signer in this order (core/go/internal/sequencer/coordinator/transaction/ready_for_dispatch.go:119-137):
  1. the domain's `fixedSigningIdentity`, if one is configured (pldconf/domainmgr.go:39; the devnet chart sets it to `""` at operator/charts/paladin-operator/values.yaml:241-245);
  2. otherwise the coordinator's dynamic identity `domains.<contractAddr>.submit.<uuid>` (core/go/internal/sequencer/coordinator/coordinating.go:454-462).
- **This is not a per-transaction one-time key.** The identity is regenerated in two cases:
  - when the coordinator becomes Active (state_machine.go:612);
  - at each epoch boundary (state_machine.go:794-805), where the epoch is `BlockRange`, default 100 blocks (config/pkg/pldconf/sequencermgr.go:83; coordinator.go:217).
  - If a used key still has unconfirmed transactions, rotation waits for a flush (state_transition_guards.go:68-72).
  - So all Zeto transactions for one contract from one sender node within an epoch share one EOA. **[A]** The code is identical at v1.0.0 (coordinating.go:411 and state_machine.go:611/805 at that tag).
- The key is resolved through the key manager, so it is HD-derived from the node seed (dispatch.go:246-250).
- The docs describe the intent: "generating a new signing key to submit each transaction to a blockchain for anonymous submission" (data_and_registry.md:28; key_management.md:33 "single-use keys for anonymous TX transaction submission"). **The code rotates per coordinator epoch, not per transaction.** The docs overstate this [A: code vs doc disagree].
- Gas: the devnet Besu uses `min-gas-price 0` and `zeroBaseFee: true` (operator/internal/controller/besu_controller.go:273; besugenesis_controller.go:164-165), so fresh keys need no funding. Funding on a gas-charging chain: **GAP** (not searched further).

### How UTXO states are distributed [A]
- The only transport shipped is gRPC. `ls transports` shows only `grpc`.
  - Absence of libp2p: `grep -rli libp2p --include=*.go --include=*.mod --include=*.md .` returns 0 hits.
- New coin states get `DistributionList: []string{owner}` (domains/zeto/internal/zeto/fungible/states.go:58-63).
- Transaction info/data states go to `[from, to]` (handler_transfer.go:180).
- The state distribution message puts the full plaintext state JSON (`sd.StateData = states[0].Data`) in the payload (core/go/internal/transportmgr/reliable_msg_handler.go:428-456).
  - A ZetoCoin is `{salt, owner, amount, locked}` (domains/zeto/pkg/types/states.go:58-63).
  - **No application-layer encryption.** `grep -rni encrypt core/go/internal/transportmgr core/go/internal/statemgr` finds 0 hits.
  - Confidentiality in flight depends solely on gRPC mTLS (§6). The doc principle says "Encryption must be end-to-end between Paladin runtimes" (data_and_registry.md:99-100); for the point-to-point gRPC case, TLS is what provides it.
- **[C]** The sender's node creates the recipient's output coins, so it knows their salt and amount, which is inherent to Zeto. The recipient receives only its own coins plus the info state.

### What is persisted in plaintext [A]
- The `states` table has a `data TEXT` column (core/go/db/migrations/postgres/000003_create_states_table.up.sql:3-12). It stores the state JSON: salt, owner and amount for every coin the node created or received.
- `transactions."data"` stores the transaction inputs, e.g. `to` and `amount` (000009_create_transactions_tables.up.sql:24-35).
- The `key_mappings` and `key_verifiers` tables store identifier to key handle to public verifier; no private keys (000011_create_key_mapping_tables.up.sql:3-29).
- The devnet database is a Postgres sidecar (templates/nodes/paladin.yaml:32-34); SQLite is also supported (paladin_controller.go:1047,1066).
- **Private keys are not in the DB.** They are in the keystore (§2).

## 2. Key management [A]

- **Keystore types.** Only two exist:
  - `filesystem` (keystorev3)
  - `static` ("unencrypted keys in-line in the config")
  - Source: config/pkg/pldconf/signer.go:22-25; implementations in toolkit/go/pkg/signer/keystores/{filesystem_storage,static_key_storage}.go.
- **The filesystem keystore password sits beside the key.** A random password is written to `<key>.pwd` next to the key file (filesystem_storage.go:116-129, 151, 181-186). Protection is therefore only filesystem permissions: 0600 files and 0700 directories by default (signer.go:77-80).
- **Key derivation** is `direct` or `bip32`, with a BIP39 mnemonic seed and BIP44 prefix default `m/44'/60'` (signer.go:45-52, 86-90).
  - BIP32 is incompatible with `keyStoreSigning`: `MsgSigningHierarchicalRequiresLoading` (toolkit/go/pkg/signer/signing_module.go:137-141).
  - ZKP needs in-memory keys (signer.go:40 comment).
- **HSM, KMS and remote signing are not implemented in-repo.**
  - Wallet `signerType` is `embedded` (the default) or `plugin` (config/pkg/pldconf/keymanager.go:48-66).
  - The only plugin is `signingmodules/example`, which is itself an in-memory signer (README:3).
  - The docs describe HSM/PKCS#11 and mTLS remote modules as an architecture option (key_management.md:41-74, 229-242).
  - Absence check: `grep -rli 'pkcs|hsm|vault|kms' --include=*.go` returns only comments in toolkit/go/pkg/signerapi/keystore.go:59-69 plus test and example files. No PKCS#11 or KMS client exists.
  - Whether a plugin wallet can serve Zeto: **[C]** it requires the plugin to embed a Zeto in-memory signer. zetosigner.NewZetoOnlyDomainRouter (domains/zeto/pkg/zetosigner/signing_module.go:37-42) exists for this purpose.
- **Default devnet / operator setup.**
  - Each node gets `secretBackedSigners: [{name: signer-1, secret: <node>.keys, type: autoHDWallet, keySelector: .*}]` (operator/charts/paladin-operator/templates/nodes/paladin.yaml:52-56).
  - The operator generates a 256-bit-entropy BIP39 mnemonic. It stores it **inline, encoding "none"**, in a Kubernetes Secret as `keys.yaml` (paladin_controller.go:1466-1490).
  - It configures a `static` keystore reading `/keystores/<name>/keys.yaml` with BIP32 derivation (paladin_controller.go:1133-1148).
  - There is one signer per node: "only one signer currently supported" (paladin_controller.go:1121-1124).
  - **So one mnemonic in one K8s Secret controls every EOA and every BabyJubJub key on that node.**

## 3. Threat model: what a compromised node can learn and do

The project publishes no explicit threat model. See §7.

- **Multi-tenancy.** One node hosts many identities ("managing the keys for many different user accounts that all transact via that Paladin node", data_and_registry.md:28).
  - Tenants are not isolated.
  - Authorization is optional (doc-site/docs/administration/auth.md:3).
  - The reference `basicauth` plugin authorizes every authenticated user for everything: "Basic auth: all authenticated users are authorized" (rpcauth/basicauth/internal/basicauth/handler.go:122-125).
  - The devnet node spec configures no authorizers (templates/nodes/paladin.yaml:25-99; no `authorizers` key).
  - `from` is a free-form key identifier resolved on demand (key_management.md:244-263). **[C]** Any RPC caller can transact as any identity on the node.
- **A compromised node, its DB, or its operator:**
  - **Learns** every local identity's coins in plaintext (states.data) and its transaction history (transactions.data, receipts). **[A]**
  - **Learns** the counterparty coin data it created as sender. **[C]**
  - **Can spend** every local user's funds: it holds or derives every BabyJubJub key and runs the prover (§1, §2). **[A]**
  - A DB-only compromise gives no keys; they sit in the keystore or K8s Secret. **[A]**
  - A compromise of the pod or the K8s Secret gives full spend authority. **[A]**
- **A compromised counterparty (recipient) node:**
  - **Learns** the coins distributed to it and the info state (from, to, data).
  - **Does not learn** the sender's input coins or the sender's change coins (their DistributionList is the owner only). **[B/C]**
  - A remote peer can make your node resolve, and create on demand, keys for arbitrary identifiers through ResolveVerifier (core/go/internal/identityresolver/identityresolver.go:261-290 calls `ResolveKeyNewDatabaseTX`). **[C]** Minor.
- **Notary: there is none in Zeto.**
  - There are no endorsers; the grep for `ENDORSE` under domains/zeto/internal finds 0, and only SIGN exists.
  - The on-chain verifier enforces validity (advanced_crypto.md:27-34).
- **For contrast only:**
  - **Noto** uses a single notary that sees all states and validates or submits them (doc-site/docs/architecture/noto.md:3-6, 488-505; SUBMITTER_COORDINATOR at noto.go:771).
  - **Pente** uses privacy-group endorsers that execute the full EVM transition off-chain and sign it (pente.md:65-91).
  - The docs say of pre-verification: "Trust in a token received, is based on trust of the issuer/pre-verifier" (advanced_crypto.md:17).

## 4. Zeto domain configuration at HEAD

- **Token names in code** (domains/zeto/pkg/constants/constants.go:25-32):
  - Zeto_Anon
  - Zeto_AnonEnc
  - Zeto_AnonNullifier
  - Zeto_AnonNullifierKyc
  - Zeto_NfAnon
  - Zeto_NfAnonNullifier
  - Circuit roles: transfer, transferLocked, deposit, withdraw (constants.go:19-22).
- **What devnet actually configures:** 4 fungible variants (Anon, AnonEnc, AnonNullifier, AnonNullifierKyc) with their circuits (operator/config/samples/core_v1alpha1_paladindomain_zeto.yaml:18-97). The same 4 are `registerImplementation`'d (operator/config/samples/core_v1alpha1_transactioninvoke_zeto_register_{anon,anon_enc,anon_nullifier,anon_nullifier_kyc}.yaml).
  - The samples are templated into the chart (operator/build.gradle:376).
  - In the AnonNullifier registration, lock and burn verifiers are the zero address (…register_anon_nullifier.yaml:31-35).
- **The docs are stale:** zeto.md:38-41 lists only Anon, AnonEnc and AnonNullifier.
- **Factory:** solidity/contracts/domains/zeto/ZetoFactory.sol:7-67 wraps Zeto's `ZetoTokenFactoryUpgradeable`. It deploys fungible or non-fungible tokens by name.
- **Proving keys are Zeto's TEST keys [A]:**
  - `downloadZetoTestProvingKeys` fetches `zeto-test-proving-keys-v0.2.2.tar.gz` from github.com/hyperledger-labs/zeto releases (domains/zeto/build.gradle:36-37, 86-92), extracted into `zkp/` (build.gradle:143-148).
  - Root build.gradle:234-291 (`copyZetoZKPFiles`, run on assemble at :308) copies the .zkey and .wasm files into the image, which the Dockerfile copies to `/app` (Dockerfile:194). The prover reads `/app/domains/zeto/zkp` (paladindomain_zeto.yaml:99-102).
  - Absence check: `grep -rn -i 'ptau|powersOfTau|trusted setup'` over *.md, *.gradle and *.yaml finds 0 hits. **Paladin documents no ceremony.**
- **Anomaly [C].** The domain configuration references circuits `anon_nullifier_transferLocked` and `anon_nullifier_kyc_transferLocked` (yaml:70, 90). The image copy list has no `*transferLocked*` zkey (`grep -n transferLocked build.gradle` finds 0). transferLocked for the nullifier variants would therefore likely fail in the stock image. Not tested.

## 5. Local multi-node setup (docs, identical at v1.0.0) [A: doc + chart]

Source: doc-site/docs/getting-started/installation.md.
- Devnet gives 3 Paladin nodes and 3 Besu nodes (installation.md:3, 68-69).
  - Chart defaults: `mode: devnet`, `nodeCount: 3`, `besuNodeCount: 3` (values.yaml:6-12).
  - Besu image `hyperledger/besu:25.8.0` (values.yaml:230-232); Postgres `17.6` (values.yaml:101).
- Prerequisites: a Kubernetes cluster, helm v3, kubectl (installation.md:7-9); kind is optional (:13-16).
- Commands:
  - installation.md:21-22
    ```
    curl https://raw.githubusercontent.com/LFDT-Paladin/paladin/refs/heads/main/operator/paladin-kind.yaml -L -O
    kind create cluster --name paladin --config paladin-kind.yaml
    ```
  - installation.md:41-42
    ```
    helm repo add paladin https://LFDT-Paladin.github.io/paladin --force-update
    helm upgrade --install paladin-crds paladin/paladin-operator-crd
    ```
  - installation.md:50-51
    ```
    helm repo add jetstack https://charts.jetstack.io --force-update
    helm install cert-manager --namespace cert-manager --version v1.16.1 jetstack/cert-manager --create-namespace --set crds.enabled=true
    ```
  - installation.md:59
    ```
    helm upgrade --install paladin paladin/paladin-operator -n paladin --create-namespace
    ```
  - Verify with `kubectl get pods`, `kubectl get scd` and `kubectl get reg` (:75-76, 118, 152).
  - UIs are at localhost:31548/ui, :31648/ui and :31748/ui (:172-174).
- **Image tags.** HEAD values.yaml has `tag: main` for the operator and paladin (values.yaml:20, 213). The release workflow overwrites them with the release tag (.github/workflows/release-charts.yaml:117-119, 135-146). The docs command pins no `--version`, so it installs the latest published chart (v1.0.0 → images v1.0.0 **[C]**). To pin, use `--version 1.0.0` (the pattern in release-charts.yaml:216).
- NodePorts: Paladin nodes at 31548 + 100·i (paladin.yaml:91-99). The kind config maps them to 127.0.0.1 (operator/paladin-kind.yaml:17-40).

## 6. Transport security and registry [A]

- The gRPC transport is **mTLS-only**:
  - "We only support mutual-TLS in this transport" (transports/grpc/internal/grpctransport/grpc_transport.go:115-117).
  - `RequireAndVerifyClientCert` (:127).
- **Default `directCertVerification: true`** (config.go:32-35, 45). In this mode:
  - Standard CA validation is skipped (`InsecureSkipVerify`, `RequireAnyClientCert`, :128-138).
  - The node name is taken from the certificate CN (or `certSubjectMatcher`).
  - The peer's `issuers` PEM is looked up in the registry and the certificate chain is verified against it (tls_verifier.go:150-205).
  - **So trust in peer identity = trust in the registry contents.**
- **Certificates.** cert-manager generates self-signed certificates per node, which are "published to the registry, and used for mTLS" (doc-site/docs/administration/certificate_management.md:3-4; operator paladin_controller.go:1398-1442; devnet `tls.secretName: paladin-<node>-mtls`, paladin.yaml:85-87).
- **Registry.** The EVM registry plugin indexes `IdentityRegistered` and `PropertySet` events from `IdentityRegistry` (data_and_registry.md:85; solidity/contracts/registry/IdentityRegistry.sol:19-26).
- **On-chain publications:**
  - node name and owner EOA (paladinregistration_controller.go:273-276, `registerIdentity` sent from the registry admin key);
  - property `transport.grpc` = JSON `{endpoint, issuers(PEM cert)}` (paladinregistration_controller.go:328-339; grpctransport/config.go:52-59).
  - This is plaintext and public on the base ledger. It is not Zeto state.
- **Access control in IdentityRegistry.sol:**
  - Only the parent owner can register a child (:72).
  - Only the identity owner can set properties (:108).
  - A `rootless` constructor lets anyone register top-level names (:45-47, :72).
  - The devnet registry admin key `registry.operator` lives on node1 (operator/config/samples/core_v1alpha1_paladinregistration_node2.yaml:10-13).

## 7. The project's own security and trust statements

- **SECURITY.md: GAP.** `find . -iname 'SECURITY*'`, which includes .github/, returns nothing. `grep -rli 'threat model|security model|vulnerabilit' doc-site/docs` returns nothing. There is no dedicated security or threat-model page under doc-site/docs/architecture (ls). The org-level LFDT SECURITY policy was not checked (offline).
- **Relevant quotes:**
  - key_management.md:26: "_The key materials never leave the store_" (describing HSM principles). The next passage explains that Paladin often loads keys into signing-module memory. Also at :43-45: "you should be cautious about where the signing modules run that will hold those keys in volatile memory."
  - key_management.md:55-56: "the majority of the quick start setup guides, and kubernetes deployment samples, have it Paladin-embedded by default."
  - key_management.md:118-119: "Only in-memory signing is possible when key derivation is performed within the signing module."
  - key_management.md:229-232: key materials live in "Local disk (for dev), Cloud Key Managers, Cloud HSMs, Software key managers, and HSMs (supporting PKCS#11)". Only local disk and static are implemented in-repo (§2).
  - data_and_registry.md:99-100: "Encryption must be end-to-end between Paladin runtimes … data must be encrypted before it leaves Paladin".
  - advanced_crypto.md:33-34 (ZKP): "Fully decentralized - any party can generate a proof … Full enforcement on-chain".
  - advanced_crypto.md:38: Zeto "has been undergoing peer review for some time".
  - cloud_native.md:5: the DB "can be embedded for development, or a reliable HA deployment of PostgreSQL for production".
  - auth.md:3: "Paladin supports optional RPC authorizers".
