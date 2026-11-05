# RedoX TV veri paketleri

RedoX TV uygulamasının kanal listesi ve yayın akışı (EPG). İki dosya da şifreli ve imzalıdır.

| Dosya | İçerik | Güncelleme |
|---|---|---|
| [`channels.bin`](channels.bin) | Kanal listesi (numara, ad, kategori, logo, yayın adresleri) | Kanal listesi değişince elle |
| [`epg.bin`](epg.bin) | 3 günlük yayın akışı (XMLTV, iki kaynak) | [İş akışı](.github/workflows/grab.yml), günde iki kez (TSİ 05:15, 17:15) |

Adres: `https://raw.githubusercontent.com/ByReDoxXx/redox-epg/main/<dosya>`

## Biçim

[`tools/pack.mjs`](tools/pack.mjs) içerik JSON'unu gzip'ler, AES-256-GCM ile şifreler ve Ed25519 ile imzalar:

```
"RDX1" (4) | tür (1: kanallar, 2: yayın akışı) | nonce (12) | şifreli metin | GCM etiketi (16) | imza (64)
```

Uygulama önce imzayı doğrular, sonra şifreyi çözer. Değiştirilmiş dosyayı reddeder. Anahtarlar GitHub Secrets'tadır (`REDOX_DATA_KEY`, `REDOX_SIGN_KEY`); depoda anahtar yoktur.

## Yayın akışı kaynakları

1. **epgshare01 Türkiye dosyası:** Türksat Kablo'nun yayın akışından.
2. **iptv-org/epg:** [iptv-org/epg](https://github.com/iptv-org/epg) aracıyla, yalnız [`redox.channels.xml`](redox.channels.xml)'deki kanallar için. Kanalların çoğu TV+'tan, biri Digiturk'ten. Digiturk GitHub sunucularından gelen istekleri reddediyor (403); bu yüzden tek kaynak olarak kullanılmıyor.

500'den az program içeren çıktı eldeki dosyanın yerine yazılmaz.

Yayın akışı bilgilerinin hakları kaynak sitelere aittir.
