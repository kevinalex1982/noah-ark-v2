/**
 * AES 加密/解密工具
 * 算法: AES/ECB/PKCS5Padding (128-bit)
 * 密钥: yanqi78989789843
 * 输出: Base64
 *
 * 用于 IAMS 平台下发的加密用户编码加解密
 */

import { createCipheriv, createDecipheriv } from 'crypto';

const AES_KEY = Buffer.from('yanqi78989789843', 'utf-8'); // 16字节 = 128位

/**
 * AES/ECB/PKCS5Padding 加密
 * @param plaintext 明文
 * @returns Base64 密文
 */
export function aesEncrypt(plaintext: string): string {
  const cipher = createCipheriv('aes-128-ecb', AES_KEY, null);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

/**
 * AES/ECB/PKCS5Padding 解密
 * @param ciphertext Base64 密文
 * @returns 明文
 */
export function aesDecrypt(ciphertext: string): string {
  const decipher = createDecipheriv('aes-128-ecb', AES_KEY, null);
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
