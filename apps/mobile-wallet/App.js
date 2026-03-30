import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';

import {
  AfroChainClient,
  createWallet,
  decryptWallet,
  encryptWallet,
  formatUnits,
  parseUnits,
  parseWalletKeystore,
  serializeWalletKeystore
} from '@afrochain/sdk';

import {
  clearDeviceWallet,
  disableBiometricUnlock,
  enableBiometricUnlock,
  getDeviceSecuritySnapshot,
  loadBiometricPassphrase,
  persistKeystoreOnDevice
} from './src/device-security';

const AFC_UNIT = 10 ** 6;
const DEFAULT_NODE_URL = Platform.select({
  android: 'http://10.0.2.2:4100',
  default: 'http://localhost:4100'
});

const DEFAULT_DEVICE_SECURITY = {
  biometricEnrolled: false,
  biometricSupported: false,
  biometricUnlockConfigured: false,
  canUseBiometricUnlock: false,
  secureStoreAvailable: false,
  storedKeystoreAddress: ''
};

function getClient(nodeUrl) {
  return new AfroChainClient({
    baseUrl: nodeUrl,
    operatorToken: process.env.EXPO_PUBLIC_AFROCHAIN_OPERATOR_TOKEN || null
  });
}

function formatAfc(amount) {
  return Number(formatUnits(amount || 0)).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

function StatCard({ label, value, tone = 'neutral' }) {
  return (
    <View style={[styles.statCard, tone === 'accent' ? styles.statCardAccent : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ eyebrow, title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function DeviceSecurityRow({ label, value }) {
  return (
    <View style={styles.deviceSecurityRow}>
      <Text style={styles.deviceSecurityLabel}>{label}</Text>
      <Text style={styles.deviceSecurityValue}>{value}</Text>
    </View>
  );
}

function ToggleRow({ description, disabled = false, label, onValueChange, value }) {
  return (
    <View style={[styles.toggleRow, disabled ? styles.toggleRowDisabled : null]}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor="#fff8ea"
        trackColor={{
          false: '#c5b9a1',
          true: '#205d54'
        }}
        value={value}
      />
    </View>
  );
}

export default function App() {
  const [nodeUrl, setNodeUrl] = useState(DEFAULT_NODE_URL);
  const [watchAddress, setWatchAddress] = useState('');
  const [wallet, setWallet] = useState(null);
  const [keystore, setKeystore] = useState(null);
  const [exportedKeystoreJson, setExportedKeystoreJson] = useState('');
  const [deviceSecurity, setDeviceSecurity] = useState(DEFAULT_DEVICE_SECURITY);
  const [devicePreferences, setDevicePreferences] = useState({
    enableBiometricUnlock: false,
    persistOnDevice: true
  });
  const [securityForm, setSecurityForm] = useState({
    confirmPassphrase: '',
    createPassphrase: '',
    importKeystoreJson: '',
    unlockPassphrase: ''
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: '12',
    destinationCountry: 'Uganda',
    mobileMoneyProvider: 'M-Pesa',
    originCountry: 'Kenya',
    recipient: 'afc_settlement_hub',
    reference: 'Mobile settlement'
  });
  const [faucetAmount, setFaucetAmount] = useState('25');
  const [faucetNote, setFaucetNote] = useState('Mobile onboarding');
  const [chain, setChain] = useState(null);
  const [database, setDatabase] = useState(null);
  const [account, setAccount] = useState(null);
  const [activity, setActivity] = useState([]);
  const [corridors, setCorridors] = useState([]);
  const [status, setStatus] = useState('Connecting to AfroChain...');
  const [busy, setBusy] = useState(true);

  const activeAddress = wallet?.address || watchAddress.trim();

  function updateSecurityForm(field, value) {
    setSecurityForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateDevicePreference(field, value) {
    setDevicePreferences((current) => {
      if (field === 'enableBiometricUnlock' && value) {
        return {
          ...current,
          enableBiometricUnlock: true,
          persistOnDevice: true
        };
      }

      if (field === 'persistOnDevice' && !value) {
        return {
          ...current,
          enableBiometricUnlock: false,
          persistOnDevice: false
        };
      }

      return {
        ...current,
        [field]: value
      };
    });
  }

  async function syncDeviceSecurityState({ restoreStoredKeystore = false } = {}) {
    const snapshot = await getDeviceSecuritySnapshot();

    setDeviceSecurity({
      biometricEnrolled: snapshot.biometricEnrolled,
      biometricSupported: snapshot.biometricSupported,
      biometricUnlockConfigured: snapshot.biometricUnlockConfigured,
      canUseBiometricUnlock: snapshot.canUseBiometricUnlock,
      secureStoreAvailable: snapshot.secureStoreAvailable,
      storedKeystoreAddress: snapshot.storedKeystore?.address || ''
    });
    setDevicePreferences((current) => ({
      enableBiometricUnlock:
        snapshot.biometricUnlockConfigured || (current.enableBiometricUnlock && snapshot.canUseBiometricUnlock),
      persistOnDevice: snapshot.secureStoreAvailable
        ? Boolean(snapshot.storedKeystore) || current.persistOnDevice
        : false
    }));

    if (restoreStoredKeystore && snapshot.storedKeystore) {
      setKeystore(snapshot.storedKeystore);
      setWatchAddress((current) => current || snapshot.storedKeystore.address);
    }

    return snapshot;
  }

  function getValidatedPassphrase() {
    if (securityForm.createPassphrase.length < 8) {
      throw new Error('Use a passphrase with at least 8 characters.');
    }

    if (securityForm.createPassphrase !== securityForm.confirmPassphrase) {
      throw new Error('Passphrase confirmation does not match.');
    }

    return securityForm.createPassphrase;
  }

  function lockWalletSession(nextStatus = 'Wallet locked. Unlock with biometrics or your passphrase to sign again.') {
    setWallet(null);
    setExportedKeystoreJson('');
    setStatus(nextStatus);
  }

  async function refreshNetwork() {
    setBusy(true);

    try {
      const client = getClient(nodeUrl);
      const [chainPayload, databasePayload, metricsPayload] = await Promise.all([
        client.getChain(),
        client.getDatabaseStatus(),
        client.getMetrics()
      ]);

      setChain(chainPayload);
      setDatabase(databasePayload);
      setCorridors((metricsPayload.corridors || []).slice(0, 4));
      setStatus(wallet ? 'Secure mobile wallet connected.' : 'Connected to an AfroChain node.');
    } catch (error) {
      setStatus(`Node unavailable: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadAccount(address = activeAddress) {
    if (!address) {
      setStatus('Create, unlock, or paste an AfroChain address to load account details.');
      return;
    }

    setBusy(true);

    try {
      const client = getClient(nodeUrl);
      const [accountPayload, activityPayload] = await Promise.all([
        client.getAccount(address),
        client.getAccountActivity(address, 6)
      ]);

      setWatchAddress(address);
      setAccount(accountPayload);
      setActivity(activityPayload);
      setStatus(wallet?.address === address ? 'Secure wallet view updated.' : 'Watch wallet view updated.');
    } catch (error) {
      setStatus(`Account lookup failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyDeviceSecurity(passphrase, nextKeystore) {
    if (deviceSecurity.secureStoreAvailable && devicePreferences.persistOnDevice) {
      await persistKeystoreOnDevice(nextKeystore);
    } else if (deviceSecurity.secureStoreAvailable) {
      await clearDeviceWallet();
    }

    if (devicePreferences.enableBiometricUnlock) {
      await persistKeystoreOnDevice(nextKeystore);
      await enableBiometricUnlock(passphrase);
    } else if (deviceSecurity.biometricUnlockConfigured) {
      await disableBiometricUnlock();
    }

    await syncDeviceSecurityState();
  }

  async function handleCreateWallet() {
    setBusy(true);

    try {
      const validatedPassphrase = getValidatedPassphrase();
      setStatus('Creating and encrypting a mobile AfroChain wallet...');
      const nextWallet = await createWallet('AfroChain Mobile Wallet');
      const nextKeystore = await encryptWallet(nextWallet, validatedPassphrase);

      await applyDeviceSecurity(validatedPassphrase, nextKeystore);

      setWallet(nextWallet);
      setKeystore(nextKeystore);
      setExportedKeystoreJson('');
      setWatchAddress(nextWallet.address);
      setSecurityForm((current) => ({
        ...current,
        confirmPassphrase: '',
        createPassphrase: '',
        unlockPassphrase: ''
      }));
      await Promise.all([refreshNetwork(), loadAccount(nextWallet.address)]);
      setStatus('Encrypted mobile wallet created.');
    } catch (error) {
      setStatus(`Wallet creation failed: ${error.message}`);
      setBusy(false);
    }
  }

  async function handleUnlockWallet() {
    if (!keystore) {
      setStatus('Import or create a keystore before unlocking.');
      return;
    }

    setBusy(true);

    try {
      setStatus('Unlocking secure mobile wallet...');
      const unlockedWallet = await decryptWallet(keystore, securityForm.unlockPassphrase);

      await applyDeviceSecurity(securityForm.unlockPassphrase, keystore);

      setWallet(unlockedWallet);
      setWatchAddress(unlockedWallet.address);
      setSecurityForm((current) => ({
        ...current,
        unlockPassphrase: ''
      }));
      await Promise.all([refreshNetwork(), loadAccount(unlockedWallet.address)]);
      setStatus('Secure wallet unlocked for this mobile session.');
    } catch (error) {
      setStatus(error.message);
      setBusy(false);
    }
  }

  async function handleBiometricUnlock() {
    setBusy(true);

    try {
      const snapshot = await syncDeviceSecurityState({
        restoreStoredKeystore: true
      });
      const targetKeystore = keystore || snapshot.storedKeystore;

      if (!targetKeystore) {
        throw new Error('No device keystore is available for biometric unlock.');
      }

      setStatus('Authorizing biometric unlock...');
      const storedPassphrase = await loadBiometricPassphrase();
      const unlockedWallet = await decryptWallet(targetKeystore, storedPassphrase);

      setKeystore(targetKeystore);
      setWallet(unlockedWallet);
      setWatchAddress(unlockedWallet.address);
      await Promise.all([refreshNetwork(), loadAccount(unlockedWallet.address)]);
      setStatus('Biometric unlock complete. Secure mobile signing is active.');
    } catch (error) {
      setStatus(`Biometric unlock failed: ${error.message}`);
      setBusy(false);
    }
  }

  async function handleImportKeystore() {
    setBusy(true);

    try {
      const nextKeystore = parseWalletKeystore(securityForm.importKeystoreJson);

      if (deviceSecurity.secureStoreAvailable && devicePreferences.persistOnDevice) {
        await persistKeystoreOnDevice(nextKeystore);
      } else if (deviceSecurity.secureStoreAvailable) {
        await clearDeviceWallet();
      }

      if (deviceSecurity.biometricUnlockConfigured && !devicePreferences.enableBiometricUnlock) {
        await disableBiometricUnlock();
      }

      setKeystore(nextKeystore);
      setWallet(null);
      setExportedKeystoreJson('');
      setWatchAddress(nextKeystore.address);
      setSecurityForm((current) => ({
        ...current,
        importKeystoreJson: '',
        unlockPassphrase: ''
      }));
      await syncDeviceSecurityState();
      await Promise.all([refreshNetwork(), loadAccount(nextKeystore.address)]);
      setStatus('Encrypted keystore imported. Unlock it to sign on mobile.');
    } catch (error) {
      setStatus(`Keystore import failed: ${error.message}`);
      setBusy(false);
    }
  }

  function handleLockWallet() {
    lockWalletSession();
  }

  async function handleForgetDeviceWallet() {
    setBusy(true);

    try {
      await clearDeviceWallet();
      setKeystore(null);
      setWallet(null);
      setExportedKeystoreJson('');
      setDevicePreferences((current) => ({
        ...current,
        enableBiometricUnlock: false,
        persistOnDevice: deviceSecurity.secureStoreAvailable ? false : current.persistOnDevice
      }));
      await syncDeviceSecurityState();
      setStatus('Secure device keystore and biometric unlock have been removed from this device.');
    } catch (error) {
      setStatus(`Device cleanup failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleExportKeystore() {
    if (!keystore) {
      setStatus('Create or import a keystore first.');
      return;
    }

    setExportedKeystoreJson(serializeWalletKeystore(keystore));
    setStatus('Encrypted recovery keystore prepared below.');
  }

  async function handleSendPayment() {
    if (!wallet) {
      setStatus('Unlock the wallet before sending AFC.');
      return;
    }

    setBusy(true);

    try {
      setStatus('Signing and broadcasting a mobile payment...');
      const client = getClient(nodeUrl);
      await client.signAndSubmit(wallet, {
        payload: {
          amount: parseUnits(paymentForm.amount),
          destinationCountry: paymentForm.destinationCountry,
          mobileMoneyProvider: paymentForm.mobileMoneyProvider,
          originCountry: paymentForm.originCountry,
          recipient: paymentForm.recipient,
          reference: paymentForm.reference
        },
        type: 'payment'
      });
      await client.produceBlock();
      await Promise.all([refreshNetwork(), loadAccount(wallet.address)]);
      setStatus('Mobile payment confirmed on AfroChain.');
    } catch (error) {
      setStatus(`Payment failed: ${error.message}`);
      setBusy(false);
    }
  }

  async function requestFaucet() {
    const recipientAddress = wallet?.address || watchAddress.trim();
    if (!recipientAddress) {
      setStatus('Unlock a wallet or paste an address before requesting faucet funds.');
      return;
    }

    setBusy(true);

    try {
      const result = await getClient(nodeUrl).requestFaucet(recipientAddress, Math.round(Number(faucetAmount || 0) * AFC_UNIT), {
        note: faucetNote
      });
      setStatus(
        result.status === 'confirmed'
          ? `Faucet confirmed in block ${result.blockHeight}.`
          : 'Faucet request queued for the next block.'
      );
      await Promise.all([refreshNetwork(), loadAccount(recipientAddress)]);
    } catch (error) {
      setStatus(`Faucet request failed: ${error.message}`);
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapApp() {
      setBusy(true);

      try {
        const client = getClient(nodeUrl);
        const [chainPayload, databasePayload, metricsPayload, securitySnapshot] = await Promise.all([
          client.getChain(),
          client.getDatabaseStatus(),
          client.getMetrics(),
          getDeviceSecuritySnapshot()
        ]);

        if (cancelled) {
          return;
        }

        setChain(chainPayload);
        setDatabase(databasePayload);
        setCorridors((metricsPayload.corridors || []).slice(0, 4));
        setDeviceSecurity({
          biometricEnrolled: securitySnapshot.biometricEnrolled,
          biometricSupported: securitySnapshot.biometricSupported,
          biometricUnlockConfigured: securitySnapshot.biometricUnlockConfigured,
          canUseBiometricUnlock: securitySnapshot.canUseBiometricUnlock,
          secureStoreAvailable: securitySnapshot.secureStoreAvailable,
          storedKeystoreAddress: securitySnapshot.storedKeystore?.address || ''
        });
        setDevicePreferences((current) => ({
          enableBiometricUnlock:
            securitySnapshot.biometricUnlockConfigured ||
            (current.enableBiometricUnlock && securitySnapshot.canUseBiometricUnlock),
          persistOnDevice: securitySnapshot.secureStoreAvailable
            ? Boolean(securitySnapshot.storedKeystore) || current.persistOnDevice
            : false
        }));

        if (securitySnapshot.storedKeystore) {
          setKeystore(securitySnapshot.storedKeystore);
          setWatchAddress(securitySnapshot.storedKeystore.address);
          const [accountPayload, activityPayload] = await Promise.all([
            client.getAccount(securitySnapshot.storedKeystore.address),
            client.getAccountActivity(securitySnapshot.storedKeystore.address, 6)
          ]);

          if (cancelled) {
            return;
          }

          setAccount(accountPayload);
          setActivity(activityPayload);
          setStatus(
            securitySnapshot.biometricUnlockConfigured
              ? 'Device keystore restored. Unlock with biometrics or your passphrase to sign.'
              : 'Encrypted keystore restored from secure device storage.'
          );
        } else {
          setStatus('Connected to an AfroChain node.');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(`Startup failed: ${error.message}`);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void bootstrapApp();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (wallet && nextState !== 'active') {
        lockWalletSession('Wallet locked after the app moved to the background. Re-unlock to sign again.');
      }
    });

    return () => {
      subscription.remove();
    };
  }, [wallet]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>AfroChain Mobile Wallet</Text>
          <Text style={styles.heroTitle}>Device-bound secure storage, biometric re-unlock, and mobile AfroCoin signing.</Text>
          <Text style={styles.heroCopy}>
            This mobile wallet now restores encrypted keystores from secure device storage, supports biometric
            re-unlock, locks signing sessions when the app backgrounds, and keeps recovery export in your control.
          </Text>
          <Text style={styles.status}>{status}</Text>
        </View>

        <Section eyebrow="Node" title="Choose your AfroChain gateway">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setNodeUrl}
            placeholder="http://10.0.2.2:4100"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={nodeUrl}
          />
          <Pressable onPress={() => void refreshNetwork()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Refresh network</Text>
          </Pressable>
        </Section>

        <View style={styles.statGrid}>
          <StatCard label="Height" value={chain?.height ?? '-'} tone="accent" />
          <StatCard label="Validators" value={chain?.activeValidatorCount ?? '-'} />
          <StatCard label="Persistence" value={chain?.persistenceMode || 'memory'} />
          <StatCard label="Socket URL" value={chain?.socketUrl ? 'enabled' : 'off'} />
        </View>

        <Section eyebrow="Security" title="Secure this device and your recovery path">
          <View style={styles.deviceSecurityCard}>
            <DeviceSecurityRow
              label="Secure storage"
              value={deviceSecurity.secureStoreAvailable ? 'available' : 'unavailable'}
            />
            <DeviceSecurityRow
              label="Biometrics"
              value={
                deviceSecurity.canUseBiometricUnlock
                  ? 'ready'
                  : deviceSecurity.biometricSupported
                    ? 'not enrolled'
                    : 'unsupported'
              }
            />
            <DeviceSecurityRow
              label="Stored keystore"
              value={deviceSecurity.storedKeystoreAddress ? 'present' : 'none'}
            />
            <DeviceSecurityRow
              label="Quick unlock"
              value={deviceSecurity.biometricUnlockConfigured ? 'enabled' : 'off'}
            />
          </View>

          <ToggleRow
            description="Persist the encrypted keystore in secure device storage so the wallet survives app restarts."
            disabled={!deviceSecurity.secureStoreAvailable}
            label="Remember encrypted keystore on this device"
            onValueChange={(value) => updateDevicePreference('persistOnDevice', value)}
            value={devicePreferences.persistOnDevice && deviceSecurity.secureStoreAvailable}
          />
          <ToggleRow
            description="After one passphrase unlock, allow future session unlock through device biometrics."
            disabled={!deviceSecurity.canUseBiometricUnlock}
            label="Enable biometric quick unlock"
            onValueChange={(value) => updateDevicePreference('enableBiometricUnlock', value)}
            value={devicePreferences.enableBiometricUnlock && deviceSecurity.canUseBiometricUnlock}
          />

          {!keystore ? (
            <>
              <TextInput
                onChangeText={(value) => updateSecurityForm('createPassphrase', value)}
                placeholder="Create passphrase"
                placeholderTextColor="#8e8470"
                secureTextEntry
                style={styles.input}
                value={securityForm.createPassphrase}
              />
              <TextInput
                onChangeText={(value) => updateSecurityForm('confirmPassphrase', value)}
                placeholder="Confirm passphrase"
                placeholderTextColor="#8e8470"
                secureTextEntry
                style={styles.input}
                value={securityForm.confirmPassphrase}
              />
              <Pressable onPress={() => void handleCreateWallet()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Create encrypted wallet</Text>
              </Pressable>
            </>
          ) : null}

          {keystore && !wallet ? (
            <>
              <Text style={styles.emptyState}>Keystore loaded for {keystore.address}. Unlock it to sign mobile payments.</Text>
              <TextInput
                onChangeText={(value) => updateSecurityForm('unlockPassphrase', value)}
                placeholder="Unlock passphrase"
                placeholderTextColor="#8e8470"
                secureTextEntry
                style={styles.input}
                value={securityForm.unlockPassphrase}
              />
              <View style={styles.buttonColumn}>
                <Pressable onPress={() => void handleUnlockWallet()} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Unlock mobile wallet</Text>
                </Pressable>
                {deviceSecurity.biometricUnlockConfigured ? (
                  <Pressable onPress={() => void handleBiometricUnlock()} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Unlock with biometrics</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}

          {wallet ? (
            <>
              <View style={styles.accountCard}>
                <Text style={styles.accountTitle}>{wallet.label}</Text>
                <Text style={styles.accountMeta}>{wallet.address}</Text>
                <Text style={styles.accountMeta}>Unlocked for this session only. Backgrounding the app will re-lock it.</Text>
              </View>
              <View style={styles.buttonColumn}>
                <Pressable onPress={handleExportKeystore} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Export keystore</Text>
                </Pressable>
                <Pressable onPress={handleLockWallet} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Lock wallet</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <TextInput
            multiline
            onChangeText={(value) => updateSecurityForm('importKeystoreJson', value)}
            placeholder="Paste encrypted keystore JSON for recovery import"
            placeholderTextColor="#8e8470"
            style={[styles.input, styles.textArea]}
            value={securityForm.importKeystoreJson}
          />
          <View style={styles.buttonColumn}>
            <Pressable onPress={() => void handleImportKeystore()} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Import keystore JSON</Text>
            </Pressable>
            {(deviceSecurity.storedKeystoreAddress || keystore) && deviceSecurity.secureStoreAvailable ? (
              <Pressable onPress={() => void handleForgetDeviceWallet()} style={styles.warnButton}>
                <Text style={styles.warnButtonText}>Forget this device</Text>
              </Pressable>
            ) : null}
          </View>

          {exportedKeystoreJson ? (
            <TextInput multiline editable={false} style={[styles.input, styles.textArea]} value={exportedKeystoreJson} />
          ) : null}
        </Section>

        <Section eyebrow="Wallet" title="Watch or sign from an account">
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setWatchAddress}
            placeholder="afc_..."
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={watchAddress}
          />
          <Pressable onPress={() => void loadAccount()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Load account</Text>
          </Pressable>

          {account ? (
            <View style={styles.accountCard}>
              <Text style={styles.accountTitle}>{account.label || account.address}</Text>
              <Text style={styles.accountMeta}>Balance: {formatAfc(account.balance)} AFC</Text>
              <Text style={styles.accountMeta}>Nonce: {account.nonce}</Text>
              <Text style={styles.accountMeta}>Staking power: {formatAfc(account.stakingPower)} AFC</Text>
              <Text style={styles.accountMeta}>Rewards: {formatAfc(account.rewards)} AFC</Text>
            </View>
          ) : null}
        </Section>

        <Section eyebrow="Payments" title="Send AfroCoin from the mobile wallet">
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, recipient: value }))}
            placeholder="Recipient address"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.recipient}
          />
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, amount: value }))}
            placeholder="Amount AFC"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.amount}
          />
          <TextInput
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, originCountry: value }))}
            placeholder="Origin country"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.originCountry}
          />
          <TextInput
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, destinationCountry: value }))}
            placeholder="Destination country"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.destinationCountry}
          />
          <TextInput
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, mobileMoneyProvider: value }))}
            placeholder="Mobile money rail"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.mobileMoneyProvider}
          />
          <TextInput
            onChangeText={(value) => setPaymentForm((current) => ({ ...current, reference: value }))}
            placeholder="Reference"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={paymentForm.reference}
          />
          <Pressable onPress={() => void handleSendPayment()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Sign and send AFC</Text>
          </Pressable>
        </Section>

        <Section eyebrow="Onboarding" title="Developer faucet">
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setFaucetAmount}
            placeholder="25"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={faucetAmount}
          />
          <TextInput
            onChangeText={setFaucetNote}
            placeholder="Mobile onboarding"
            placeholderTextColor="#8e8470"
            style={styles.input}
            value={faucetNote}
          />
          <Pressable onPress={() => void requestFaucet()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Request faucet AFC</Text>
          </Pressable>
        </Section>

        <Section eyebrow="Activity" title="Recent wallet events">
          {(activity || []).length ? (
            activity.map((entry) => (
              <View key={entry.id} style={styles.listCard}>
                <Text style={styles.listTitle}>{entry.summary}</Text>
                <Text style={styles.listMeta}>{entry.corridor || entry.type}</Text>
                <Text style={styles.listMeta}>
                  {entry.amount ? `${formatAfc(entry.amount)} AFC` : 'Governance / contract event'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyState}>Load an account to see indexed wallet activity.</Text>
          )}
        </Section>

        <Section eyebrow="Corridors" title="Cross-border payment trends">
          {corridors.length ? (
            corridors.map((corridor) => (
              <View key={corridor.name} style={styles.listCard}>
                <Text style={styles.listTitle}>{corridor.name}</Text>
                <Text style={styles.listMeta}>{formatAfc(corridor.volume)} AFC settled</Text>
                <Text style={styles.listMeta}>{corridor.transactions} tracked payments</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyState}>Corridor data appears here once the node is connected.</Text>
          )}
        </Section>

        <Section eyebrow="Persistence" title="Node durability signals">
          <View style={styles.accountCard}>
            <Text style={styles.accountTitle}>{database?.enabled ? 'SQLite enabled' : 'Snapshot only'}</Text>
            <Text style={styles.accountMeta}>Snapshots: {database?.snapshotCount ?? 0}</Text>
            <Text style={styles.accountMeta}>Sync runs: {database?.syncRunCount ?? 0}</Text>
            <Text style={styles.accountMeta}>
              Latest snapshot: {database?.latestSnapshot?.height != null ? `#${database.latestSnapshot.height}` : 'none'}
            </Text>
          </View>
        </Section>

        {busy ? <ActivityIndicator color="#205d54" size="large" style={styles.spinner} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#f5efe1',
    flex: 1
  },
  container: {
    gap: 18,
    padding: 20,
    paddingBottom: 40
  },
  hero: {
    backgroundColor: '#205d54',
    borderRadius: 28,
    gap: 10,
    padding: 24
  },
  heroEyebrow: {
    color: '#d6f0eb',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase'
  },
  heroTitle: {
    color: '#fff8ea',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34
  },
  heroCopy: {
    color: '#d5eadf',
    fontSize: 15,
    lineHeight: 22
  },
  status: {
    color: '#fff8ea',
    fontSize: 13,
    fontWeight: '600'
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  statCard: {
    backgroundColor: '#fff9ed',
    borderColor: '#dfd2bb',
    borderRadius: 22,
    borderWidth: 1,
    flexBasis: '47%',
    gap: 6,
    padding: 16
  },
  statCardAccent: {
    backgroundColor: '#ffcc73',
    borderColor: '#f1b24a'
  },
  statLabel: {
    color: '#6c604d',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  statValue: {
    color: '#1b1a17',
    fontSize: 18,
    fontWeight: '800'
  },
  section: {
    backgroundColor: '#fff9ed',
    borderColor: '#dfd2bb',
    borderRadius: 26,
    borderWidth: 1,
    padding: 20
  },
  eyebrow: {
    color: '#9b6a2b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 6,
    textTransform: 'uppercase'
  },
  sectionTitle: {
    color: '#1d1b18',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 14
  },
  sectionBody: {
    gap: 12
  },
  input: {
    backgroundColor: '#f3ead8',
    borderColor: '#dbc8a8',
    borderRadius: 16,
    borderWidth: 1,
    color: '#221f19',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top'
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#205d54',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  primaryButtonText: {
    color: '#fffaf0',
    fontSize: 15,
    fontWeight: '700'
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffcc73',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  secondaryButtonText: {
    color: '#3f2a06',
    fontSize: 15,
    fontWeight: '700'
  },
  warnButton: {
    alignItems: 'center',
    backgroundColor: '#f5dccd',
    borderColor: '#d57f4c',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  warnButtonText: {
    color: '#7a3310',
    fontSize: 15,
    fontWeight: '700'
  },
  buttonColumn: {
    gap: 12
  },
  accountCard: {
    backgroundColor: '#f3ead8',
    borderRadius: 18,
    gap: 6,
    padding: 16
  },
  accountTitle: {
    color: '#1d1b18',
    fontSize: 18,
    fontWeight: '800'
  },
  accountMeta: {
    color: '#5d5245',
    fontSize: 14,
    lineHeight: 20
  },
  listCard: {
    backgroundColor: '#f3ead8',
    borderRadius: 18,
    gap: 4,
    padding: 16
  },
  listTitle: {
    color: '#1d1b18',
    fontSize: 15,
    fontWeight: '700'
  },
  listMeta: {
    color: '#5d5245',
    fontSize: 13,
    lineHeight: 18
  },
  emptyState: {
    color: '#6e6458',
    fontSize: 14,
    lineHeight: 20
  },
  deviceSecurityCard: {
    backgroundColor: '#f3ead8',
    borderRadius: 18,
    gap: 8,
    padding: 16
  },
  deviceSecurityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  deviceSecurityLabel: {
    color: '#5d5245',
    fontSize: 14,
    fontWeight: '600'
  },
  deviceSecurityValue: {
    color: '#1d1b18',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: '#f3ead8',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    padding: 16
  },
  toggleRowDisabled: {
    opacity: 0.6
  },
  toggleCopy: {
    flex: 1,
    gap: 4
  },
  toggleLabel: {
    color: '#1d1b18',
    fontSize: 15,
    fontWeight: '800'
  },
  toggleDescription: {
    color: '#5d5245',
    fontSize: 13,
    lineHeight: 18
  },
  spinner: {
    marginVertical: 12
  }
});
