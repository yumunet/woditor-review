import { Inflate, zipSync } from 'fflate';
import type { Workspace } from './model';
import { backupFileName, backupJson, backupTextLimit, restoreJson } from './storage';

const badZip = () => new Error('バックアップZIPが破損しているか、対応していない形式です');
const tooLarge = () => new Error('バックアップが大きすぎます');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export async function createBackup(workspace: Workspace, date = new Date()) {
  const name = backupFileName(date),
    text = backupJson(workspace);
  if (text.length > backupTextLimit) throw tooLarge();
  const bytes = zipSync(
    { [name.replace(/\.zip$/, '.json')]: new TextEncoder().encode(text) },
    { level: 6 },
  );
  return { name, blob: new Blob([bytes], { type: 'application/zip' }) };
}

async function view(blob: Blob) {
  return new DataView(await blob.arrayBuffer());
}
async function zipEntry(file: Blob, limit: number) {
  const tailStart = Math.max(0, file.size - 65_557),
    tail = await view(file.slice(tailStart));
  let end = tail.byteLength - 22;
  for (; end >= 0; end--)
    if (
      tail.getUint32(end, true) === 0x06054b50 &&
      end + 22 + tail.getUint16(end + 20, true) === tail.byteLength
    )
      break;
  if (
    end < 0 ||
    tail.getUint16(end + 4, true) ||
    tail.getUint16(end + 6, true) ||
    tail.getUint16(end + 8, true) !== 1 ||
    tail.getUint16(end + 10, true) !== 1
  )
    throw badZip();
  const directorySize = tail.getUint32(end + 12, true),
    directoryOffset = tail.getUint32(end + 16, true);
  if (
    directorySize < 46 ||
    directorySize > 256 * 1024 ||
    directoryOffset + directorySize !== tailStart + end
  )
    throw badZip();
  const central = await view(file.slice(directoryOffset, directoryOffset + directorySize));
  if (
    central.getUint32(0, true) !== 0x02014b50 ||
    central.getUint32(42, true) !== 0 ||
    central.getUint16(34, true)
  )
    throw badZip();
  const flags = central.getUint16(8, true),
    method = central.getUint16(10, true),
    crc = central.getUint32(16, true);
  const compressed = central.getUint32(20, true),
    expanded = central.getUint32(24, true),
    nameLength = central.getUint16(28, true);
  if (
    flags & 0x41 ||
    ![0, 8].includes(method) ||
    46 + nameLength + central.getUint16(30, true) + central.getUint16(32, true) !== directorySize
  )
    throw badZip();
  if (expanded > limit * 3 + 3) throw tooLarge();
  const nameBytes = new Uint8Array(central.buffer, 46, nameLength);
  const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
  if (
    !name.toLowerCase().endsWith('.json') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes(':') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw badZip();
  const local = await view(file.slice(0, 30));
  if (
    local.byteLength !== 30 ||
    local.getUint32(0, true) !== 0x04034b50 ||
    local.getUint16(6, true) !== flags ||
    local.getUint16(8, true) !== method ||
    local.getUint16(26, true) !== nameLength
  )
    throw badZip();
  const localName = new Uint8Array(await file.slice(30, 30 + nameLength).arrayBuffer());
  if (localName.length !== nameLength || localName.some((byte, i) => byte !== nameBytes[i]))
    throw badZip();
  const start = 30 + nameLength + local.getUint16(28, true),
    finish = start + compressed;
  if (start > directoryOffset || finish > directoryOffset) throw badZip();
  if (flags & 8) {
    const descriptor = await view(file.slice(finish, directoryOffset));
    const offset =
      descriptor.byteLength === 16 && descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0;
    if (
      descriptor.byteLength !== offset + 12 ||
      descriptor.getUint32(offset, true) !== crc ||
      descriptor.getUint32(offset + 4, true) !== compressed ||
      descriptor.getUint32(offset + 8, true) !== expanded
    )
      throw badZip();
  } else if (
    finish !== directoryOffset ||
    local.getUint32(14, true) !== crc ||
    local.getUint32(18, true) !== compressed ||
    local.getUint32(22, true) !== expanded
  )
    throw badZip();
  return { start, finish, expanded, crc, method };
}

/** Read either legacy JSON or our single-entry ZIP, without retaining a full byte buffer. */
export async function readBackup(file: Blob, limit = backupTextLimit): Promise<Workspace> {
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const entry = magic[0] === 0x50 && magic[1] === 0x4b ? await zipEntry(file, limit) : null;
  const decoder = new TextDecoder('utf-8', { fatal: true }),
    pieces: string[] = [];
  let bytes = 0,
    chars = 0,
    crc = 0xffffffff;
  const append = (data: Uint8Array) => {
    bytes += data.length;
    if (bytes > limit * 3 + 3 || (entry && bytes > entry.expanded)) throw tooLarge();
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    const text = decoder.decode(data, { stream: true });
    chars += text.length;
    if (chars > limit) throw tooLarge();
    pieces.push(text);
  };
  const inflate = entry?.method === 8 ? new Inflate(append) : null;
  const reader = file
    .slice(entry?.start ?? 0, entry?.finish ?? file.size)
    .stream()
    .getReader();
  let consumed = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bound each inflate allocation even for highly compressible input.
      for (let i = 0; i < value.length; i += 16 * 1024) {
        const part = value.subarray(i, i + 16 * 1024);
        consumed += part.length;
        if (inflate) inflate.push(part, consumed === entry!.finish - entry!.start);
        else append(part);
      }
    }
    if (inflate && !consumed) inflate.push(new Uint8Array(), true);
    const last = decoder.decode();
    if (chars + last.length > limit) throw tooLarge();
    pieces.push(last);
    if (entry && (bytes !== entry.expanded || (crc ^ 0xffffffff) >>> 0 !== entry.crc))
      throw badZip();
    return restoreJson(pieces.join(''));
  } finally {
    pieces.length = 0;
    await reader.cancel();
    reader.releaseLock();
  }
}
