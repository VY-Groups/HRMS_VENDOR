# Vendor License Tool

This folder is a separate vendor-side product for managing HRMS commercial customers and issuing HRMS customer licenses.

## Design Intent

- It has its own backend and frontend.
- It does not import code from the HRMS app.
- It does not call the HRMS API.
- It does not read the HRMS database.
- It stores vendor-side commercial customer records locally in this folder.
- It issues signed, opaque encrypted license tokens for HRMS.

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
- The vendor tool and the HRMS tool do not need a runtime network connection to each other.
- The vendor signing private key never belongs in HRMS. HRMS receives the matching public key. The HRMS decryption private key is shared with the vendor tool for its existing license-inspection workflows.
- Customer records are stored only in `data/customers.json` at the repository root.

## Important Production Note

Configure a new Ed25519 signing pair and RSA encryption pair before issuing licenses. Store each value as base64-encoded PEM in the respective `.env` file:

- Vendor `.env`: `VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64`, `VENDOR_LICENSE_SIGNING_PUBLIC_KEY_B64`, `VENDOR_LICENSE_ENCRYPTION_PUBLIC_KEY_B64`, and `VENDOR_LICENSE_ENCRYPTION_PRIVATE_KEY_B64`.
- HRMS `.env`: `HRMS_LICENSE_SIGNING_PUBLIC_KEY_B64` and `HRMS_LICENSE_ENCRYPTION_PRIVATE_KEY_B64`.

The vendor service currently needs the HRMS encryption private key for its license-inspection endpoint. Anyone who compromises the vendor runtime could read license contents; keep it on a trusted network. Do not reuse the previous shared master key for license signing.

## Run

```bash
npm start
```

Run the command from the repository root. The default local address is:

- `http://localhost:3005/`

## Run with Docker

Create `backend/.env` with the required production keys, then build and run with persistent named volumes:

```bash
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

## Verify

```bash
npm run verify
```
