# Vendor License Tool

This folder is a separate vendor-side product for managing HRMS commercial customers and issuing HRMS customer licenses.

## Design Intent

- It has its own backend and frontend.
- It does not import code from the HRMS app.
- It does not call the HRMS API.
- It does not read the HRMS database.
- It stores vendor-side commercial customer records locally in this folder.
- It issues signed, opaque encrypted license tokens for HRMS.

## How the Products Work Together

The vendor console manages customer and license records. An operator issues an HRMS3 license and delivers the resulting key to the customer. HRMS reads the key from `license.key`, verifies the Ed25519 signature, decrypts the payload, then applies its expiry, plan, feature, and hardware-binding checks.

There is no vendor-to-HRMS API or database connection. The integration is a versioned license format plus key configuration. Revocation is the only ongoing data path: the vendor publishes a signed CRL to GitHub, and HRMS fetches and verifies that file on its configured schedule. Email and GitHub backup are vendor-console integrations, separate from license validation.

## What Data It Manages

This tool is for vendor-side business operations, such as:

- customer legal name and workspace name
- customer contacts and billing contacts
- plan defaults and commercial limits
- hardware binding IDs provided by the customer
- renewal dates and internal commercial notes
- issued license history for that customer

It is not for managing HRMS tenant runtime data such as employees, leave, attendance, tickets, or payroll data.

## Security Model

- License tokens are emitted in the `HRMS3-...` format.
- The token payload is encrypted with AES-256-GCM. Each token uses a random data key wrapped with the HRMS RSA public key.
- The vendor signs the encrypted envelope with Ed25519. HRMS verifies the signature before decrypting it.
- HRMS1 and HRMS2 tokens are no longer accepted. Existing licenses must be reissued by the vendor.
- Old HMAC-signed revocation lists are no longer trusted; publish a fresh CRL after configuring the new Ed25519 key.
- The vendor tool and HRMS do not need a direct runtime network connection.
- Vendor signing private key stays in the vendor tool; HRMS receives its matching public key.
- **Current key-separation limitation:** the vendor tool also stores the HRMS encryption private key for its license-inspection endpoint. A compromise of the vendor runtime can expose decrypted license payloads. Keep the vendor service private until this inspection path is redesigned.
- Customer records are stored only in `data/customers.json` at the repository root.

## Important Production Note

Configure a new Ed25519 signing pair and RSA encryption pair before issuing licenses. Store each value as base64-encoded PEM in the respective `.env` file:

- Vendor `.env`: `VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64`, `VENDOR_LICENSE_SIGNING_PUBLIC_KEY_B64`, `VENDOR_LICENSE_ENCRYPTION_PUBLIC_KEY_B64`, and `VENDOR_LICENSE_ENCRYPTION_PRIVATE_KEY_B64`.
- HRMS `.env`: `HRMS_LICENSE_SIGNING_PUBLIC_KEY_B64` and `HRMS_LICENSE_ENCRYPTION_PRIVATE_KEY_B64`.

Do not reuse the previous shared master key for license signing. Keep signing private keys, encryption private keys, setup tokens, session secrets, GitHub tokens, and SMTP credentials out of source control and logs. Use separate, least-privilege secrets per environment.

## Integration Configuration

| Setting or artifact | Configured in | Purpose |
| --- | --- | --- |
| `VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64` | Vendor | Signs licenses and CRLs; never copy this private key to HRMS. |
| `HRMS_LICENSE_SIGNING_PUBLIC_KEY_B64` | HRMS | Verifies vendor license and CRL signatures. |
| `VENDOR_LICENSE_ENCRYPTION_PUBLIC_KEY_B64` | Vendor | Encrypts license payloads for the target HRMS deployment. |
| `HRMS_LICENSE_ENCRYPTION_PRIVATE_KEY_B64` | HRMS; currently also vendor | Decrypts licenses. Vendor-side use is a security limitation documented above. |
| `license.key` | HRMS deployment | License file installed by the HRMS operator. |
| `CRL_GITHUB_*` | Vendor | Publishes signed revocation lists. Use a dedicated token scoped to the CRL repository. |
| `HRMS_CRL_URL` / `HRMS_CRL_TOKEN` | HRMS | Reads the published CRL. HRMS keeps a cached verified list when refresh fails. |
| `VENDOR_GITHUB_*` | Vendor | Optional vendor-data backup and restore; configure a separate least-privilege token/repository. |
| SMTP settings | Vendor console | Sends operator setup, password-reset, and customer messages. They are not required to verify an installed license. |

Keep the signing public key, encryption key pair, license file, and CRL settings for a given HRMS deployment aligned. A mismatched key pair makes newly issued licenses unverifiable or undecryptable.

The tracked `.env.example` is a variable-name template, not a runnable configuration. Copy it to `backend/.env`, replace every placeholder with fresh environment-specific values, and keep the file out of Git. `VENDOR_SETUP_TOKEN` must be at least 32 characters. `VENDOR_PUBLIC_URL` must be the externally reachable HTTPS URL so reset links do not point to localhost. SMTP credentials are currently entered in the operator console and stored in the vendor data volume.

## Run

```bash
npm start
```

Run the command from the repository root. The default local address is:

- `http://localhost:3005/`

## Run with Docker

Create `backend/.env` with the required production keys, then build and run with persistent named volumes:

```bash
cp .env.example backend/.env
# Edit backend/.env and replace every placeholder before starting the service.
docker build -t hrms-vendor-tool .
docker run -d --name hrms-vendor-poc --restart unless-stopped --env-file backend/.env -p 127.0.0.1:3010:3005 -v hrms-vendor-poc-data:/app/data -v hrms-vendor-poc-backend-data:/app/backend/data hrms-vendor-tool
```

This local example binds to loopback on port `3010`; use a TLS reverse proxy before exposing the service outside the machine.

On a fresh install, configure `VENDOR_SETUP_TOKEN` with a random value of at least 32 characters in `backend/.env`. Enter that token on the first-operator setup screen. Setup requests are rejected if the token is missing or incorrect.

## Operator Access

- On first launch, the console asks you to create the first vendor operator account.
- First-operator setup requires the deployment setup token.
- After setup, the vendor tool opens behind its own operator sign-in screen.
- Customer registry, issuance, and manifest APIs are now protected behind that vendor session.
- The vendor tool remains operationally separate from HRMS auth and tenant data.

## VAPT Preparation and Current Gaps

**Status: not ready to describe as VAPT-ready.** This README and source review are not a penetration test. The following code-level issues must be addressed and verified before a public or customer-data deployment:

- Password reset currently returns its reset token in the unauthenticated API response, even when email is configured.
- Operator roles are shown in the UI, but the API routes do not consistently enforce role-based permissions; an authenticated operator can reach management actions.
- API responses and preflight handling allow every origin through `Access-Control-Allow-Origin: *`.
- Request bodies are collected without a size limit, including on public authentication routes.
- Login throttling trusts the first `X-Forwarded-For` value and is process-local, so proxy topology and multiple instances can weaken it.
- SMTP TLS certificate validation is disabled in both mail send paths.
- The console uses inline event handlers. Setting `script-src-attr 'none'` would block these controls until they are moved to registered event listeners; the vendor server also lacks the browser security-header set documented for HRMS.
- The vendor service holds the HRMS decryption private key for license inspection.
- The free Render Blueprint has no persistent disk; local JSON customer/operator data can be lost on restart or redeploy.

Before testing, use an isolated staging deployment with synthetic customer data, separate test keys, test-only GitHub repositories, test mail credentials, named/persistent storage, and one account per intended role. Restrict tester access to the staging host, set `NODE_ENV=production`, configure the HTTPS endpoint in `VENDOR_PUBLIC_URL`, and rotate all test secrets after the engagement. Do not give testers production tokens or the HRMS decryption private key.

The frontend has a responsive breakpoint at 768px, but it has not had a browser-based desktop/tablet/mobile visual audit in this change. Its large single-file script and inline event handlers are the clearest maintainability and CSP-improvement targets; verify any redesign in real viewport screenshots before calling it complete.

## Verify

```bash
npm run verify
```
