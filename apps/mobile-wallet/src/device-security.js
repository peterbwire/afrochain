import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { parseWalletKeystore, serializeWalletKeystore } from '@afrochain/sdk';

const STORED_KEYSTORE_KEY = 'afrochain.mobile.keystore.v1';
const BIOMETRIC_PASSPHRASE_KEY = 'afrochain.mobile.biometric-passphrase.v1';
const BIOMETRIC_ENABLED_KEY = 'afrochain.mobile.biometric-enabled.v1';

const KEYSTORE_SERVICE = 'AfroChainMobileWallet';
const BIOMETRIC_SERVICE = 'AfroChainMobileBiometric';

async function getSecureStoreAvailability() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function getBiometricAvailability() {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync()
    ]);

    return {
      biometricEnrolled: isEnrolled,
      biometricSupported: hasHardware
    };
  } catch {
    return {
      biometricEnrolled: false,
      biometricSupported: false
    };
  }
}

async function readStoredKeystore() {
  const serializedKeystore = await SecureStore.getItemAsync(STORED_KEYSTORE_KEY, {
    keychainService: KEYSTORE_SERVICE
  });

  if (!serializedKeystore) {
    return null;
  }

  try {
    return parseWalletKeystore(serializedKeystore);
  } catch {
    await SecureStore.deleteItemAsync(STORED_KEYSTORE_KEY, {
      keychainService: KEYSTORE_SERVICE
    });
    return null;
  }
}

export async function getDeviceSecuritySnapshot() {
  const [secureStoreAvailable, biometricAvailability] = await Promise.all([
    getSecureStoreAvailability(),
    getBiometricAvailability()
  ]);

  let biometricUnlockConfigured = false;
  let storedKeystore = null;

  if (secureStoreAvailable) {
    const [storedBiometricFlag, nextStoredKeystore] = await Promise.all([
      SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY),
      readStoredKeystore()
    ]);

    biometricUnlockConfigured = storedBiometricFlag === 'enabled';
    storedKeystore = nextStoredKeystore;
  }

  return {
    ...biometricAvailability,
    biometricUnlockConfigured,
    canUseBiometricUnlock:
      secureStoreAvailable && biometricAvailability.biometricSupported && biometricAvailability.biometricEnrolled,
    secureStoreAvailable,
    storedKeystore
  };
}

export async function persistKeystoreOnDevice(keystore) {
  if (!(await getSecureStoreAvailability())) {
    throw new Error('Secure device storage is not available on this device.');
  }

  await SecureStore.setItemAsync(STORED_KEYSTORE_KEY, serializeWalletKeystore(keystore), {
    keychainService: KEYSTORE_SERVICE
  });
}

export async function clearDeviceWallet() {
  if (!(await getSecureStoreAvailability())) {
    return;
  }

  await Promise.all([
    SecureStore.deleteItemAsync(STORED_KEYSTORE_KEY, {
      keychainService: KEYSTORE_SERVICE
    }),
    SecureStore.deleteItemAsync(BIOMETRIC_PASSPHRASE_KEY, {
      keychainService: BIOMETRIC_SERVICE
    }),
    SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)
  ]);
}

async function authenticateWithDevice(promptMessage) {
  const result = await LocalAuthentication.authenticateAsync({
    cancelLabel: 'Cancel',
    promptMessage
  });

  if (!result.success) {
    throw new Error('Biometric authentication was cancelled or unavailable.');
  }
}

export async function enableBiometricUnlock(passphrase) {
  const securitySnapshot = await getDeviceSecuritySnapshot();

  if (!securitySnapshot.canUseBiometricUnlock) {
    throw new Error('Biometric unlock is not available on this device yet.');
  }

  await authenticateWithDevice('Confirm biometrics to enable AfroChain quick unlock');

  await Promise.all([
    SecureStore.setItemAsync(BIOMETRIC_PASSPHRASE_KEY, passphrase, {
      authenticationPrompt: 'Unlock AfroChain wallet',
      keychainService: BIOMETRIC_SERVICE,
      requireAuthentication: true
    }),
    SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'enabled')
  ]);
}

export async function disableBiometricUnlock() {
  if (!(await getSecureStoreAvailability())) {
    return;
  }

  await Promise.all([
    SecureStore.deleteItemAsync(BIOMETRIC_PASSPHRASE_KEY, {
      keychainService: BIOMETRIC_SERVICE
    }),
    SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY)
  ]);
}

export async function loadBiometricPassphrase() {
  const securitySnapshot = await getDeviceSecuritySnapshot();

  if (!securitySnapshot.biometricUnlockConfigured) {
    throw new Error('Biometric unlock is not configured on this device.');
  }

  if (!securitySnapshot.canUseBiometricUnlock) {
    throw new Error('This device cannot complete biometric unlock right now.');
  }

  await authenticateWithDevice('Use biometrics to unlock AfroChain');

  const passphrase = await SecureStore.getItemAsync(BIOMETRIC_PASSPHRASE_KEY, {
    authenticationPrompt: 'Unlock AfroChain wallet',
    keychainService: BIOMETRIC_SERVICE,
    requireAuthentication: true
  });

  if (!passphrase) {
    throw new Error('No biometric unlock secret is stored on this device.');
  }

  return passphrase;
}
