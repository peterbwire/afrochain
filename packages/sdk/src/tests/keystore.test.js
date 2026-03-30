import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeWalletPassphrase,
  decryptWallet,
  encryptWallet,
  parseWalletKeystore,
  serializeWalletKeystore
} from '../keystore.js';
import { createWallet } from '../wallet.js';

test('AfroChain SDK encrypts and decrypts wallet keystores', async () => {
  const wallet = await createWallet('Keystore Test Wallet');
  const keystore = await encryptWallet(wallet, 'afrochain-passphrase');
  const unlockedWallet = await decryptWallet(keystore, 'afrochain-passphrase');

  assert.equal(keystore.address, wallet.address);
  assert.equal(keystore.publicKey, wallet.publicKey);
  assert.equal('privateKey' in keystore, false);
  assert.deepEqual(unlockedWallet, wallet);
});

test('AfroChain SDK rejects wallet unlock with the wrong passphrase', async () => {
  const wallet = await createWallet('Locked Wallet');
  const keystore = await encryptWallet(wallet, 'correct-horse-battery');

  await assert.rejects(
    decryptWallet(keystore, 'wrong-passphrase'),
    /Wallet unlock failed/
  );
});

test('AfroChain SDK can rotate keystore passphrases and parse serialized payloads', async () => {
  const wallet = await createWallet('Rewrapped Wallet');
  const initialKeystore = await encryptWallet(wallet, 'initial-passphrase');
  const serializedKeystore = serializeWalletKeystore(initialKeystore);
  const parsedKeystore = parseWalletKeystore(serializedKeystore);
  const rotatedKeystore = await changeWalletPassphrase(parsedKeystore, 'initial-passphrase', 'next-passphrase');

  await assert.rejects(
    decryptWallet(rotatedKeystore, 'initial-passphrase'),
    /Wallet unlock failed/
  );

  const unlockedWallet = await decryptWallet(rotatedKeystore, 'next-passphrase');
  assert.deepEqual(unlockedWallet, wallet);
});
