import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { verifySettingsPassword, createSettingsAccess } from '../src/settings-access.js';

test('密码校验保留符号和空格，拒绝错误密码和损坏的配置', async () => {
  const password = 'test-' + randomBytes(12).toString('hex') + ' !# ';
  const salt = randomBytes(16);
  const policy = { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: salt.toString('hex'), verifier: pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex') };
  assert.equal(await verifySettingsPassword(password, policy), true);
  assert.equal(await verifySettingsPassword(password.trim(), policy), false);
  assert.equal(await verifySettingsPassword('incorrect', policy), false);
  await assert.rejects(verifySettingsPassword(password, { ...policy, verifier: '' }));
  await assert.rejects(verifySettingsPassword(password, { ...policy, iterations: 0 }));
});

test('锁定清除当前会话，存储不可用时仍默认锁定', () => {
  const records = new Map();
  const storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const access = createSettingsAccess(storage, '/JYE/');
  assert.equal(access.isUnlocked(), false);
  access.lock();
  assert.equal(access.isUnlocked(), false);
  const unavailable = createSettingsAccess({ getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
  assert.equal(unavailable.isUnlocked(), false);
  unavailable.lock();
});
