import { generateKeyPairSync, sign } from 'node:crypto';

export interface GeneratedCsr {
  privateKeyPem: string;
  publicKeyPem: string;
  csrPem: string;
}

/** Generates the software-key equivalent of a TPM-resident RSA key and PKCS#10 CSR. */
export function generateOperationalCsr(commonName: string): GeneratedCsr {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(commonName)) throw new Error('CSR common name is invalid');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  const subject = sequence(set(sequence(
    oid(Buffer.from([0x55, 0x04, 0x03])),
    tlv(0x0c, Buffer.from(commonName, 'utf8')),
  )));
  const certificationRequestInfo = sequence(
    integerZero(),
    subject,
    publicKeyDer,
    tlv(0xa0, Buffer.alloc(0)),
  );
  const signature = sign('sha256', certificationRequestInfo, privateKey);
  const signatureAlgorithm = sequence(
    oid(Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])),
    tlv(0x05, Buffer.alloc(0)),
  );
  const csrDer = sequence(
    certificationRequestInfo,
    signatureAlgorithm,
    tlv(0x03, Buffer.concat([Buffer.from([0x00]), signature])),
  );

  return {
    privateKeyPem,
    publicKeyPem,
    csrPem: pem('CERTIFICATE REQUEST', csrDer),
  };
}

function integerZero(): Buffer {
  return tlv(0x02, Buffer.from([0x00]));
}

function oid(body: Buffer): Buffer {
  return tlv(0x06, body);
}

function sequence(...values: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(values));
}

function set(...values: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(values));
}

function tlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function derLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid DER length');
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function pem(label: string, der: Buffer): string {
  const base64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}
