# AfroChain Mobile Wallet

This app is the Expo-based mobile wallet shell for AfroChain. It sits on the future `afrochain-wallet` repository boundary together with the web wallet, but it is already a real signing surface rather than a watch-only demo shell.

## What the Mobile Wallet Does Today

The app currently supports:

- node URL selection for local nodes, validators, and remote gateways
- encrypted wallet generation with the shared `@afrochain/sdk` keystore format
- encrypted keystore import and export for recovery
- secure device persistence with `expo-secure-store`
- biometric quick unlock with `expo-local-authentication`
- automatic session lock when the app backgrounds
- signed AfroCoin payments
- watch-mode account lookup
- recent account activity
- developer faucet onboarding
- corridor visibility
- chain height, validator count, and persistence visibility

## Security Model

The current mobile wallet separates three layers of custody:

1. Session wallet: an unlocked in-memory wallet used only while the app stays active.
2. Recovery keystore: the encrypted JSON keystore that can be exported for backup or imported on another device.
3. Device vault: optional device-bound storage for the encrypted keystore plus optional biometric re-unlock metadata.

### Device persistence

If secure storage is available, the user can choose to remember the encrypted keystore on the device. This keeps the wallet recoverable after app restarts without leaving the signing key unlocked.

### Biometric unlock

If the device supports and has enrolled biometrics, the user can opt into biometric quick unlock. The app then:

- stores the encrypted keystore in secure device storage
- stores a biometric-protected secret needed for re-unlock
- requires biometric confirmation before restoring a signing session

### Background lock

When the app leaves the foreground, the signing session is cleared automatically. The keystore may still remain on-device if the user enabled secure persistence, but the decrypted wallet does not.

## Default Node URL

The app chooses its default URL by platform:

- Android emulator: `http://10.0.2.2:4100`
- other platforms: `http://localhost:4100`

## Local Development

From the repo root:

```bash
npm run dev:mobile-wallet
```

If the connected node protects operator routes, set:

```bash
EXPO_PUBLIC_AFROCHAIN_OPERATOR_TOKEN=dev-operator-token
```

The mobile wallet uses that token automatically for faucet and other operator-grade flows.

Or from this workspace:

```bash
npm run start
```

Platform-specific helpers:

```bash
npm run android
npm run ios
npm run web
```

## Main Flows

### Create wallet

The user creates a new encrypted keystore, optionally stores it on-device, and can immediately enable biometric quick unlock.

### Import recovery keystore

The user pastes encrypted keystore JSON, decides whether to remember it on-device, and then unlocks it with the passphrase.

### Unlock wallet

The user can unlock with:

- the keystore passphrase
- biometrics, if quick unlock has been configured earlier on the same device

### Send AfroCoin

Once unlocked, the wallet signs and submits a `payment` transaction through the AfroChain node API.

### Request faucet funds

The user can request devnet faucet AFC for the active or watched address.

### Watch account state

The wallet loads account details and recent indexed activity without requiring an unlocked signing session.

## Data Sources

The app reads:

- `/chain`
- `/database`
- `/metrics`
- `/accounts/:address`
- `/accounts/:address/activity`
- `/faucet`

It writes signed transactions through the same node API surface used by the web wallet and CLI.

## Current Limitations

- no native secure enclave key generation yet
- no staking or governance submission yet in the mobile shell
- no QR payment or contact-book flow yet
- no passphrase rotation UI yet
- no device-to-device recovery wizard yet
- no emulator or physical-device verification is encoded in CI

## Next Strong Upgrades

- native secure enclave or hardware-backed key generation
- staking and governance actions from mobile
- QR receive and payment request flows
- safer recovery export and import UX
- signed peer-aware node selection for mobile networks
