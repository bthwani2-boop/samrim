import crypto from "node:crypto";

const benchmarkRangeStart = 0xc6120000;
const benchmarkRangeSize = 131_070;

function challengeSourceIP(phone) {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new TypeError("challenge source requires a normalized E.164 phone");
  const hash = crypto.createHash("sha256").update("bthwani-disposable-runtime-client\0").update(phone).digest();
  const offset = hash.readUInt32BE(0) % benchmarkRangeSize + 1;
  const address = benchmarkRangeStart + offset;
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join(".");
}

export function challengeSourceHeaders(phone) {
  return { "X-Forwarded-For": challengeSourceIP(phone) };
}

export function challengeSourceHash(phone, secret) {
  const mac = crypto.createHmac("sha256", secret);
  for (const [index, part] of ["client-ip", challengeSourceIP(phone)].entries()) {
    if (index > 0) mac.update("\0");
    mac.update(part);
  }
  return mac.digest("hex");
}
