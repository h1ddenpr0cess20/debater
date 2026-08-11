/**
 * PCM16 in and out of base64, for the engine that carries audio as JSON.
 *
 * The OpenAI engine never comes through here: its audio rides a media track on
 * the peer connection and the browser does the encoding. xAI's realtime socket
 * takes and returns base64 PCM in the event stream itself, which is most of the
 * traffic on that engine and the reason both of these are written to be dull.
 */
export function encodePCM(samples) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodePCM(base64) {
  if (typeof base64 !== 'string' || !base64) return null;

  let binary;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  /** An odd number of bytes is not PCM16, and would misalign everything after. */
  if (binary.length % 2) return null;

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
