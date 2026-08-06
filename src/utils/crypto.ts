/**
 * Legacy reversible obfuscation retained only for backwards compatibility with
 * old local data. This is not cryptographic protection: any script running in
 * the same browser origin can read both the value and its device salt. Do not
 * use these helpers to store API keys, access tokens, passwords, or other
 * secrets. Current runtime code keeps the Gemini key in sessionStorage instead.
 */

// Generate or retrieve a device-specific local salt to ensure key uniqueness per device
function getDeviceSalt(): string {
  let salt = localStorage.getItem("_device_s_k");
  if (!salt) {
    // Generate a random high-entropy salt
    const array = new Uint8Array(16);
    if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(array);
    } else {
      for (let i = 0; i < 16; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    salt = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("_device_s_k", salt);
  }
  return salt;
}

/**
 * Reversibly obfuscates legacy text. Do not use for secrets.
 */
export function secureEncrypt(plainText: string, userId?: string): string {
  if (!plainText) return "";
  
  const salt = getDeviceSalt();
  const derivationKey = (userId || "anonymous") + "-" + salt;
  
  // Convert plain text to character codes
  const textBytes = Array.from(plainText).map((char) => char.charCodeAt(0));
  const keyBytes = Array.from(derivationKey).map((char) => char.charCodeAt(0));
  
  // XOR cipher with rolling index + salt mixing
  const encryptedBytes = textBytes.map((byte, index) => {
    const keyByte = keyBytes[index % keyBytes.length];
    // Scramble using XOR and dynamic shifting based on position and salt character codes
    const shift = (salt.charCodeAt(index % salt.length) + index) % 256;
    return (byte ^ keyByte ^ shift) & 255;
  });
  
  // Return safe Base64 representation prefixed to easily detect secure format
  const binaryString = String.fromCharCode(...encryptedBytes);
  return "SECURE_v1:" + btoa(binaryString);
}

/**
 * Reverses the legacy obfuscation format.
 */
export function secureDecrypt(encryptedText: string, userId?: string): string {
  if (!encryptedText) return "";
  if (!encryptedText.startsWith("SECURE_v1:")) {
    // Fallback in case there is old cleartext stored
    return encryptedText;
  }
  
  try {
    const base64Data = encryptedText.substring(10); // Remove "SECURE_v1:"
    const binaryString = atob(base64Data);
    const encryptedBytes = Array.from(binaryString).map((char) => char.charCodeAt(0));
    
    const salt = getDeviceSalt();
    const derivationKey = (userId || "anonymous") + "-" + salt;
    const keyBytes = Array.from(derivationKey).map((char) => char.charCodeAt(0));
    
    const decryptedBytes = encryptedBytes.map((byte, index) => {
      const keyByte = keyBytes[index % keyBytes.length];
      const shift = (salt.charCodeAt(index % salt.length) + index) % 256;
      return (byte ^ shift ^ keyByte) & 255;
    });
    
    return String.fromCharCode(...decryptedBytes);
  } catch (err) {
    console.error("Failed to decode legacy obfuscated text:", err);
    return "";
  }
}
