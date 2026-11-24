import { hostData, issuePairingCode, pairingLifetime } from './pairing.mjs';

const code = await issuePairingCode(hostData);
console.log('Pairing code: ' + code);
console.log('Valid for ' + pairingLifetime / 60_000 + ' minutes, single use.');
