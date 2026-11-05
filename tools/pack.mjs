// RedoX TV veri paketi: JSON'u gzip'ler, AES-256-GCM ile şifreler, Ed25519 ile
// imzalar. Uygulama önce imzayı doğrular, sonra çözer.
//
// Biçim:
//   "RDX1" (4) | tür (1: 1 kanallar, 2 yayın akışı, 3 radyolar) | nonce (12)
//   | şifreli metin | GCM etiketi (16) | imza (64)
// Başlık (ilk 5 bayt) GCM'de ek veri (AAD) olarak kullanılır: bir türün dosyası
// ötekinin yerine konamaz. İmza, imzadan önceki her şeyi kapsar.
//
// Kullanım:
//   node tools/pack.mjs channels <kanallar.m3u> <channels.bin>
//   node tools/pack.mjs radios <radyolar.m3u> <radios.bin>   (aynı M3U kuralları)
//   node tools/pack.mjs epg <xmltv.xml.gz>... <epg.bin>
// Anahtarlar ortamdan: REDOX_DATA_KEY (32 bayt, base64), REDOX_SIGN_KEY
// (Ed25519 gizli anahtar, PKCS#8 PEM).
import { createCipheriv, createPrivateKey, randomBytes, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { gzipSync } from 'node:zlib'

const KINDS = { channels: 1, epg: 2, radios: 3 }

function pack(kind, payload) {
  const key = Buffer.from(process.env.REDOX_DATA_KEY ?? '', 'base64')
  if (key.length !== 32) throw new Error('REDOX_DATA_KEY 32 bayt (base64) olmalı')
  const signKey = createPrivateKey(process.env.REDOX_SIGN_KEY ?? '')
  const header = Buffer.concat([Buffer.from('RDX1'), Buffer.from([KINDS[kind]])])
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))), cipher.final()])
  const signed = Buffer.concat([header, nonce, body, cipher.getAuthTag()])
  return Buffer.concat([signed, sign(null, signed, signKey)])
}

// M3U → kanal listesi. Uygulamanın M3uParser'ıyla aynı kurallar: aynı tvg-id'li
// (yoksa aynı adlı) kayıtlar tek kanalın akışlarıdır; numaraya göre sıralı,
// numarasızlar sonda ve en büyük numaradan sonra numaralanır.
function parseM3u(text) {
  const byKey = new Map()
  let pending = null
  let order = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      let quoted = false
      let comma = line.length - 1
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted
        if (line[i] === ',' && !quoted) {
          comma = i
          break
        }
      }
      const attrs = Object.fromEntries([...line.slice(0, comma).matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
      const nonEmpty = s => (s && s.trim() ? s.trim() : null)
      pending = {
        id: nonEmpty(attrs['tvg-id']),
        name: line.slice(comma + 1).trim(),
        number: /^\d+$/.test(attrs['tvg-chno'] ?? '') ? Number(attrs['tvg-chno']) : null,
        logo: nonEmpty(attrs['tvg-logo']),
        category: nonEmpty(attrs['group-title']) ?? 'Diğer',
        order: ++order,
        streams: []
      }
    } else if (!line.startsWith('#') && pending) {
      const key = pending.id ?? pending.name
      if (!byKey.has(key)) byKey.set(key, pending)
      byKey.get(key).streams.push(line)
      pending = null
    }
  }
  const entries = [...byKey.values()].sort((a, b) => (a.number ?? 2 ** 30) - (b.number ?? 2 ** 30) || a.order - b.order)
  let next = Math.max(0, ...entries.map(e => e.number ?? 0))
  return entries.map(e => ({
    number: e.number ?? ++next,
    name: e.name,
    category: e.category,
    ...(e.logo ? { logo: e.logo } : {}),
    streams: e.streams
  }))
}

const [kind, ...args] = process.argv.slice(2)
const out = args.pop()
if (!(kind in KINDS) || args.length === 0 || !out) {
  console.error('Kullanım: node tools/pack.mjs channels|radios|epg <girdi>... <çıktı.bin>')
  process.exit(2)
}
const generated = new Date().toISOString()
const payload =
  kind === 'channels'
    ? { version: 1, generated, channels: parseM3u(readFileSync(args[0], 'utf8')) }
    : kind === 'radios'
    ? { version: 1, generated, radios: parseM3u(readFileSync(args[0], 'utf8')) }
    : {
        version: 1,
        generated,
        // Kaynaklar öncelik sırasıyla; uygulama birleştirir.
        sources: args.map(f => ({ name: basename(f), xmltv: readFileSync(f).toString('base64') }))
      }
const bin = pack(kind, payload)
writeFileSync(out, bin)
const count =
  kind === 'channels'
    ? `${payload.channels.length} kanal`
    : kind === 'radios'
    ? `${payload.radios.length} istasyon`
    : `${payload.sources.length} kaynak`
console.log(`${out}: ${count}, ${bin.length} bayt`)
