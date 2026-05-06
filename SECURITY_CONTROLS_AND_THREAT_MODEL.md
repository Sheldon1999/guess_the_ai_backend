# Guess The AI Security Controls and Threat Model

## Scope

This document covers backend/API controls for:

- Authentication and session integrity
- Gameplay answer submission abuse resistance
- Blockchain submission integrity and replay resistance
- DA metadata exposure boundaries
- Operational hardening for production review

## Trust Boundaries

- **Client/browser:** untrusted input surface (wallet address, guesses, mode payloads).
- **Backend API:** enforcement point for auth, abuse checks, and business invariants.
- **Privy/JWT identity:** trusted only after cryptographic verification.
- **0G/chain writers:** trusted execution path, but must be bounded by backend validation.

## Implemented Controls

### 1) Authentication hardening

- JWT secrets are mandatory:
  - `JWT_SECRET`
  - `BROWSER_JWT_SECRET`
- No insecure fallback defaults.
- Legacy login middleware now requires browser JWT path (`source=browser`).
- Added wallet challenge-sign auth path for non-Privy/external sign-in:
  - `POST /api/auth/challenge`
  - `POST /api/auth/wallet-login`
- Challenge is one-time, expires, and signature must recover the claimed wallet.

### 2) Abuse controls on gameplay answer endpoints

- Added per-wallet and per-IP velocity checks.
- Added duplicate payload anomaly detection (repeated identical submissions in a short window).
- Applied guard to all answer submit routes:
  - `/api/game/ans`
  - `/api/game/classic/answer`
  - `/api/game/multiselect/answer`
  - `/api/game/duel/answer`
  - `/api/game/oddoneout/answer`
  - `/api/game/cardflip/answer`
  - `/api/game/rapidfire/answer`

### 3) Blockchain integrity controls

- On-chain answer records now submit the **user-provided answer/guess**, not backend truth fallback.
- Added Redis idempotency key (wallet + session + question) before on-chain submission to reduce duplicate/replay writes.
- Default chain config aligned to mainnet defaults in backend on-chain client.

### 4) DA privacy controls

- DA status/snapshot/retrieve routes are protected by auth.
- Wallet scope enforced: requested wallet must match authenticated wallet in token.

### 5) Operational hardening

- Removed secret-bearing URL logs (`MONGO_URL`).
- Added global and auth-specific rate limiters.
- Internal DA ingestion now fails closed when `DA_INTERNAL_API_KEY` is unset.

## Residual Risks / Next Steps

1. **Contract-side replay guarantees**
   - Keep contract-level duplicate/replay checks as defense in depth.

2. **Adaptive anomaly scoring**
   - Add rolling suspicious score per wallet (wrong-answer burst, impossible deltas).

3. **Audit logging**
   - Add structured security event stream for blocked/rate-limited/challenge-fail actions.

4. **Test depth**
   - Expand tests to include:
     - full challenge-sign login flow
     - wallet scope authorization checks
     - anti-abuse middleware integration tests with mocked Redis

## Production Checklist

- [ ] `JWT_SECRET` and `BROWSER_JWT_SECRET` set and rotated
- [ ] `DA_INTERNAL_API_KEY` set
- [ ] Rate-limit envs tuned for expected traffic
- [ ] Monitoring for 401/403/429 spikes
- [ ] Chain IDs and contract addresses validated for deployment target
- [ ] Security test suite passing in CI

