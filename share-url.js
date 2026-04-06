import os from 'os';

function isPrivateIpv4(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [first, second] = parts;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function scoreInterfaceName(name) {
  const normalized = name.toLowerCase();
  const virtualKeywords = ['virtual', 'vethernet', 'vmware', 'docker', 'loopback', 'bridge', 'hamachi', 'hyper-v', 'default switch', 'pseudo', 'tunnel'];

  if (virtualKeywords.some((keyword) => normalized.includes(keyword))) {
    return -100;
  }

  if (normalized === 'wi-fi' || normalized === 'wifi' || normalized.includes('wi-fi') || normalized.includes('wifi')) {
    return 100;
  }

  if (normalized === 'wlan' || normalized.startsWith('wlan ')) {
    return 95;
  }

  if (normalized === 'ethernet') {
    return 90;
  }

  if (normalized.startsWith('ethernet ') && !/\d$/.test(normalized)) {
    return 80;
  }

  return 50;
}

export function getLanIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        candidates.push({ name: name.toLowerCase(), address: entry.address });
      }
    }
  }

  const rankedCandidates = candidates
    .filter((candidate) => isPrivateIpv4(candidate.address))
    .map((candidate) => ({ ...candidate, score: scoreInterfaceName(candidate.name) }))
    .sort((a, b) => b.score - a.score);

  return rankedCandidates[0]?.address ?? candidates[0]?.address ?? '127.0.0.1';
}

export function buildShareUrl(port, protocol = 'http') {
  return `${protocol}://${getLanIpAddress()}:${port}`;
}
