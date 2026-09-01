# DID private-key signer design

This repository does not implement or invoke a live signer yet. Future signing must use a separate, approved process boundary.

## Contract

- Request: a structured message containing only the signing algorithm, canonical data to sign, and an optional public identifier.
- Response: a structured result containing only the signature and non-secret public metadata such as the public key or DID.
- The signer reads the key internally and never returns it, its JWK, seed, or raw bytes.

## Required behavior

- Keep the key in a dedicated filesystem location denied to Claude's sandbox and normal `Read` access.
- Write no key material to stdout, stderr, logs, telemetry, crash reports, HTTP requests, or Git.
- Disable shell tracing and avoid interpolating secret values into command arguments.
- On failure, return a fixed error code and redacted message; never dump request, key, stack data, or serialized crypto objects.
- Accept requests through a narrow local IPC or equivalent interface, with an allowlisted algorithm and caller authorization.
- Keep all Technocore network writes outside the signer and disabled until explicitly approved.