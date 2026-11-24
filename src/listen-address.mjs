import { networkInterfaces } from 'node:os';

// Prefer a LAN address a second device can use. Container bridges and VM
// adapters are usually only reachable from this machine.
export function privateListenAddress(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (/^(docker|veth|br-|virbr|vboxnet|vmnet|bridge)/i.test(name)) continue;
    for (const { address, family, internal } of entries ?? []) {
      if (internal) continue;
      if (family === 'IPv4') {
        const [a, b] = address.split('.').map(Number);
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
          candidates.push({ address, rank: 0 });
        } else if (a === 100 && b >= 64 && b <= 127) {
          candidates.push({ address, rank: 1 });
        }
      } else if (family === 'IPv6' && /^f[cd]/i.test(address)) {
        candidates.push({ address, rank: 2 });
      }
    }
  }
  return candidates.sort((a, b) => a.rank - b.rank)[0]?.address ?? '127.0.0.1';
}
