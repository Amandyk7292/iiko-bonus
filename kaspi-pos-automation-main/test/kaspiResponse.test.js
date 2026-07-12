import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getKaspiErrorMessage,
  getKaspiResultCode,
  isKaspiSessionExpired,
  isKaspiSuccess,
} from '../src/kaspiResponse.js';

describe('Kaspi response semantics', () => {
  it('accepts numeric and string zero status codes', () => {
    assert.equal(isKaspiSuccess({ StatusCode: 0, Data: {} }), true);
    assert.equal(isKaspiSuccess({ StatusCode: '0', Data: {} }), true);
  });

  it('does not treat a response without a result code as success', () => {
    assert.equal(isKaspiSuccess({ Data: {} }), false);
  });

  it('returns a non-zero nested result code instead of hiding it behind envelope success', () => {
    assert.equal(getKaspiResultCode({ StatusCode: 0, ResultCode: 12, Code: -101001 }), 12);
    assert.equal(getKaspiResultCode({ StatusCode: null, ResultCode: 12, Code: -101001 }), 12);
    assert.equal(getKaspiResultCode({ Code: -101001 }), -101001);
  });

  it('detects the session-replaced response variants returned by Kaspi', () => {
    const message = 'Был выполнен вход с другого устройства. Для входа в текущее приложение введите логин/пароль';
    assert.equal(isKaspiSessionExpired({ ResultCode: 12, Message: message }), true);
    assert.equal(isKaspiSessionExpired({ Code: -101001, Message: message }), true);
    assert.equal(isKaspiSessionExpired({ StatusCode: 5, Message: 'Сессия истекла' }), true);
  });

  it('does not let StatusCode 0 hide a nested session error', () => {
    assert.equal(isKaspiSuccess({ StatusCode: 0, ResultCode: 12 }), false);
    assert.equal(isKaspiSessionExpired({ StatusCode: 0, ResultCode: 12 }), true);
  });

  it('extracts a useful error message', () => {
    assert.equal(getKaspiErrorMessage({ Description: 'Ошибка Kaspi' }), 'Ошибка Kaspi');
  });
});
