import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { secureEncrypt, secureDecrypt } from './crypto';

describe('crypto utils', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  it('encrypts and decrypts a string successfully without userId', () => {
    const plainText = 'my-super-secret-api-key';
    const encrypted = secureEncrypt(plainText);
    
    expect(encrypted).not.toBe(plainText);
    expect(encrypted.startsWith('SECURE_v1:')).toBe(true);
    
    const decrypted = secureDecrypt(encrypted);
    expect(decrypted).toBe(plainText);
  });

  it('encrypts and decrypts a string successfully with userId', () => {
    const plainText = 'another-secret-key';
    const userId = 'user123';
    
    const encrypted = secureEncrypt(plainText, userId);
    
    expect(encrypted).not.toBe(plainText);
    expect(encrypted.startsWith('SECURE_v1:')).toBe(true);
    
    const decrypted = secureDecrypt(encrypted, userId);
    expect(decrypted).toBe(plainText);
  });

  it('fails to decrypt correctly with wrong userId', () => {
    const plainText = 'secret-key';
    const encrypted = secureEncrypt(plainText, 'userA');
    
    const decrypted = secureDecrypt(encrypted, 'userB');
    expect(decrypted).not.toBe(plainText);
  });

  it('returns original string if not in secure format', () => {
    const plainText = 'not-encrypted';
    const decrypted = secureDecrypt(plainText);
    expect(decrypted).toBe(plainText);
  });

  it('returns empty string when encrypting empty text', () => {
    expect(secureEncrypt('')).toBe('');
  });

  it('returns empty string when decrypting empty text', () => {
    expect(secureDecrypt('')).toBe('');
  });
});
