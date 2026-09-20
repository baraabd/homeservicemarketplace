import { AppError } from '../../../shared/errors/app-error';
/** A published derivative is a deliberately redacted raster, never an original
 * PDF with recoverable layers. Drop ancillary metadata; semantic redaction still
 * requires an authorized human's explicit attestation before publication. */
export function sanitizedRedactedPng(input: Buffer): Buffer {
  const invalid = () =>
    new AppError('VALIDATION_ERROR', 'A redacted copy must be a non-animated PNG.', 400);
  if (input.length < 33 || input.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw invalid();
  const keep: Buffer[] = [input.subarray(0, 8)];
  let pos = 8;
  let header = false;
  let data = false;
  let ended = false;
  while (pos < input.length) {
    if (pos + 12 > input.length) throw invalid();
    const size = input.readUInt32BE(pos);
    const end = pos + 12 + size;
    if (end > input.length) throw invalid();
    const type = input.toString('ascii', pos + 4, pos + 8);
    if (!/^[a-zA-Z]{4}$/.test(type) || ['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalid();
    if (type === 'IHDR') {
      if (header || pos !== 8 || size !== 13) throw invalid();
      header = true;
      const width = input.readUInt32BE(pos + 8),
        height = input.readUInt32BE(pos + 12);
      if (!width || !height || width * height > 40_000_000) throw invalid();
    }
    if (!header) throw invalid();
    if (type === 'IDAT') data = true;
    if (['IHDR', 'PLTE', 'IDAT', 'tRNS', 'IEND'].includes(type))
      keep.push(input.subarray(pos, end));
    else if (type[0] === type[0].toUpperCase()) throw invalid();
    pos = end;
    if (type === 'IEND') {
      if (size !== 0 || pos !== input.length) throw invalid();
      ended = true;
      break;
    }
  }
  if (!ended || !data) throw invalid();
  return Buffer.concat(keep);
}
