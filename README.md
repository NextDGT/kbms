# KBMS — Kurumsal Belge Maskeleme Sistemi

> **Kullanıcılar için:** İndirme bağlantıları ve kullanım kılavuzu → **https://nextdgt.github.io/kbms/**

KBMS (Kurumsal Belge Maskeleme Sistemi), PDF ve Word (DOCX) belgelerindeki kişisel verileri takma adlara (token) çeviren, tamamen **offline** çalışan bir Electron masaüstü uygulamasıdır. Anonim belge üçüncü tarafa verilir; geri dönüş anahtarları her anonim belgenin kaydında, kullanıcının parolasından türetilen anahtarla şifreli JSON olarak durur ve yalnızca oturum açıkken çözülür. Üçüncü taraf paketinde anahtar yoktur.

Tipik kullanım: bir hukuk bürosu veya kurum, kişisel veri içeren bir belgeyi dış bir hizmet sağlayıcıya (çeviri, analiz, yapay zekâ aracı vb.) KVKK’ya uygun biçimde göndermek ister. KBMS belgedeki kişisel verileri maskeler, dönen belgedeki token’ları tekrar gerçek değerlere çevirir.

Hedeflenen veri türleri:

| Tür | Token | Tespit |
|---|---|---|
| Ad | `[AD_n]` | Sözlük + büyük/küçük harf kuralı |
| Soyad | `[SOYAD_n]` | Sözlük + büyük/küçük harf kuralı |
| T.C. Kimlik No | `[TCKN_n]` | 11 hane + algoritma kontrolü |
| Vergi Kimlik No | `[VKN_n]` | 10 hane + algoritma kontrolü |
| IBAN | `[IBAN_n]` | `TR` + 24 hane (boşluk / tire serbest) |
| E-posta | `[EMAIL_n]` | Düzenli ifade |
| Telefon | `[TEL_n]` | 10–12 hane, `+90` / `0` önekli veya öneksiz |
| Plaka | `[PLAKA_n]` | Türk sivil plaka biçimi (il 01–81) |
| Özel maske | `[OZEL_n]` | Kullanıcının metinden seçtiği herhangi bir parça |

---

## İçindekiler

- [Gereksinimler](#gereksinimler)
- [Kurulum ve çalıştırma](#kurulum-ve-çalıştırma)
- [Kullanım akışı](#kullanım-akışı)
- [Ekranlar](#ekranlar)
- [Token’lar](#tokenlar)
- [Anahtarlar ve eşleme](#anahtarlar-ve-eşleme)
- [Kişisel veri tespiti](#kişisel-veri-tespiti)
- [Güvenlik ve şifreleme](#güvenlik-ve-şifreleme)
- [Veri ve dosya düzeni](#veri-ve-dosya-düzeni)
- [Mimari](#mimari)
- [Komutlar](#komutlar)
- [Testler](#testler)
- [Paketleme ve sürüm](#paketleme-ve-sürüm)
- [Bilinen sınırlar](#bilinen-sınırlar)
- [Geliştirme kuralları](#geliştirme-kuralları)

---

## Gereksinimler

- Node.js 22 (CI bu sürümle derler)
- Yerel geliştirme için önerilen ortam:
  - [Docker](https://docs.docker.com/get-docker/)
  - [Cursor](https://cursor.com/) veya VS Code + Dev Containers eklentisi
  - Linux host’ta pencere için X11 (`DISPLAY`)

`better-sqlite3` yerel (native) bir modüldür; `npm install` sonrası `postinstall` adımı onu Electron sürümüne göre `electron-rebuild` ile yeniden derler.

## Kurulum ve çalıştırma

### DevContainer ile

1. Repoyu aç → **Reopen in Container**.
2. `postCreate` adımı `npm install` çalıştırır.
3. `postStart` adımı `DISPLAY` tanımlı değilse uyarı verir.

Host tarafında X11 erişimini aç ve uygulamayı başlat:

```bash
xhost +local:docker
export DISPLAY=:0
npm run dev
```

Container `--network=host`, `--ipc=host` ile çalışır ve `/tmp/.X11-unix` bağlanır. Vite geliştirme sunucusu `5173` portundadır.

### Container olmadan

```bash
npm install
npm run dev
```

## Kullanım akışı

```
 PDF/DOCX yükle ──► Anonimleştir ──► Anahtarları düzenle ──► Anonim belge üret
                                                               │
                                                               ▼
 Geri yüklenmiş belge ◄── Token’ları çöz ◄── Dönen belgeyi yükle ◄── Üçüncü taraf export
```

1. **Hesap.** Yerel hesap aç veya gir. Kullanıcı adı en az 3, parola en az 6 karakter. Parola doğrulaması ve anahtar şifreleme anahtarı bu paroladan türetilir. Anahtar yalnızca bellekte tutulur; çıkışta veya uygulama kapanınca silinir.
2. **Klasör.** Klasörler sayfasında **+**’ya bas, açılan pencerede klasör adını yaz ve **Oluştur**’a bas; yeni klasörün içine geçilir. Klasör yalnızca belgeleri bir arada tutar; klasör düzeyinde anahtar yoktur.
3. **Belge yükle.** Bir PDF veya bir Word belgesi (DOCX) seç. Dosya klasör dizinine kopyalanır, metin bir kez çıkarılır ve satır düzeni (girinti, yazı boyu, kalınlık, hizalama, satır aralığı, sayfa sonu; PDF’te ayrıca her satır parçasının sayfadaki konumu) `document_blocks` tablosuna yazılır. DOCX’te gövdenin yanında üst/alt bilgi, dipnot, sonnot, yorum ve metin kutularının metni de alınır. Metin katmanı olmayan (taranmış) PDF sayfaları çevrimdışı OCR ile okunur; sihirbaz hangi sayfaların OCR’dan geçtiğini uyarı olarak gösterir. OCR’ın da metin çıkaramadığı PDF ve metni olmayan DOCX reddedilir. Eski `.doc` biçimi desteklenmez.
4. **Anonimleştir.** Klasördeki belgeye tıklayınca belge detay sayfası açılır. Orijinal belgenin sayfasında **Anonimleştir**’e bas. Dosya yeniden okunmaz; metin kaydedilmiş satır düzeninden kurulur. Tespit edilen her değer (yapısal alanlar ve sözlükteki ad/soyadlar) bir anahtar olarak gelir. Her anonimleştirme bağımsızdır; numaralar `[AD_1]`’den başlar. DOCX’te üst/alt bilgi, dipnot ve yorumlar metnin sonunda `— Üst bilgi —` gibi başlıklar altında görünür. Görsel veya gömülü nesne varsa ekranın üstünde uyarı çıkar.
5. **Anahtarları düzenle.** Ekranın solunda işaretli metin, sağında anahtar listesi bulunur. **Metindeki işaretler, üretilecek belgede token’a çevrilecek yerlerin kendisidir:** ana süreçte, çıktıyı yazan fonksiyonla ve aynı satır bölmesiyle hesaplanır (bkz. [Anahtarlar ve eşleme](#anahtarlar-ve-eşleme)).
   - Her anahtar tek satırdır: token, tür, değer, kaç yerde eşleştiği ve (ad/soyadda) metindeki `AA` (büyük harf) / `Aa` (isim yazımı) sayısı. Eşleşmesi olmayan anahtar kırmızı uyarı gösterir.
   - Ad ve soyadda **eşleme biçimi** seçilir: **AA/Aa** (her yazım), **AA** (yalnız büyük harf), **Aa** (yalnız isim yazımı). Örnek: soyad belgede `TÜRK` diye yazılıyorsa **AA**, “Türk Ceza Kanunu”nu dışarıda bırakır. Varsayılan: soyad **AA**, ad **Aa**, diğer türler her yazım. Seçilen biçimin dışında kalan yazım varsa anahtar satırında turuncu uyarı çıkar (ör. “26 AA yazım eşlenmiyor”).
   - Anahtarın türünü veya değerini **Düzenle**, istemediğini **Kaldır**. **+** ile elle anahtar ekle (değer belgede geçmelidir; plaka biçimi doğrulanır).
   - Özel maskeye ekleme veya düzenlemede kendi token adı verilebilir: `[OZEL_1]` yerine `[XYZ]`. Boş bırakılırsa sıradaki `[OZEL_n]` kullanılır.
   - Metinde **sağ tık**:
     - *Ad olarak ekle*, *Soyad olarak ekle*, *Özel maskele*. Ad/soyad olarak eklenenler kullanıcının sözlüğüne de yazılır.
     - İşaretli bir yerde *Bu yerde [SOYAD_1] uygulama*: o anahtar **yalnız o geçişte** uygulanmaz; aynı değerin diğer geçişleri token’a çevrilmeye devam eder. Yok sayılan yer gri, kesik çizgili görünür; üzerinde sağ tık → *Yok saymayı geri al*.
     - Yok sayma **anahtara bağlıdır**, yeri kilitlemez: aynı yer başka bir anahtara açıktır. Örnek: “Türk Marşı”ndaki “Türk” için soyadı yok sayıp “Türk Marşı”nı seçerek *Özel maskele* dendiğinde o yer `[OZEL_1]` olur. Yok sayma, token numaraları yenilense de korunur; anahtarın değeri düzenlenirse onunla taşınır, anahtar kaldırılırsa silinir.
     - İşaretli bir yerde *İfadeyi her zaman yok say…*: Tıklanan değer ve ardından gelen iki kelimeden bir ifade önerilir (son kelimenin eki atılır: “Türk Ceza Kanunu’nun” → “Türk Ceza Kanunu”). İfade düzenlenebilir, tıklanan yeri içermelidir ve kalıcı listeye eklenir; bu ve sonraki belgelerde geçtiği her yerde uygulanır.
     - İşaretli bir yerde *Anahtarı kaldır*.
   - Bir işarete veya anahtara tıklayınca o anahtarın yerleri arasında **←** / **→** ile gezilir. Yenile düğmesi token numaralarını metindeki sıraya göre yeniden verir.
   - Anahtar listesinin altında *Yok sayılan yerler* (çevresindeki metinle) ve *Her zaman yok sayılan ifadeler* görünür; ikisi de oradan kaldırılabilir.
   - **Vazgeç** hiçbir dosya yazmaz.
6. **Anonim belgeyi üret.** Anonim belge yazılır; anahtarları o belgenin kaydına şifreli JSON olarak girer. Çıktı orijinale göre değişir (bkz. [Biçimin korunması](#biçimin-korunması)):
   - **DOCX orijinal →** aynı Word belgesi yerinde değiştirilir.
   - **PDF orijinal →** sihirbazdaki *Çıktı biçimi* seçimine göre **DOCX (düzenlenebilir)** veya **PDF (yerleşim korunur)**.

   Ekran yeni belgenin detay sayfasına geçer. Aynı orijinalden ikinci anonimleştirme yeni bir süreçtir; kendi token’larıyla ayrı bir anonim belge üretir, öncekiler yerinde kalır.
7. **Üçüncü taraf export.** Anonim belgenin detay sayfasından yapılır. Yalnızca anonim dosya (DOCX veya PDF) kopyalanır. İlk export’ta KVKK onayı istenir (sayfadaki onay kutusu da aynı işi görür). Kayıt penceresi iptal edilirse dosyayı İndirilenler’e yazmak önerilir. Anahtarlar pakete girmez.
8. **Geri yükle.** Üçüncü taraftan dönen PDF veya DOCX’i, gönderilen anonim belgenin detay sayfasındaki **Dönen belgeyi geri yükle** ile yükle. Gelen dosya o anonim belgeye bağlı bir *dönen* belge olarak saklanır; token’lar yalnızca o anonim belgenin anahtarlarıyla çözülür ve `geri-{dosya}` adıyla aynı biçimde ayrı bir geri yüklenmiş belge üretilir: dönen DOCX yerinde değiştirilir (üçüncü tarafın biçimlendirmesi korunur), dönen PDF satırları yerinde yeniden çizilir. Ekran bu belgenin detay sayfasına geçer; **Geri yüklenmişi indir** ile dışarı kaydedilir.

## Ekranlar

| Ekran | İçerik |
|---|---|
| Giriş | Hesap açma ve giriş |
| Klasörler | Klasör listesi, **+** ile yeni klasör (ad açılan pencerede yazılır, sonra klasör açılır), silme. Silme klasörün tüm belgelerini ve dosyalarını kaldırır |
| Klasör detayı | Klasör adını düzenleme (başlığın yanındaki kalem; Enter kaydeder, Esc vazgeçer), belge listesi (orijinal / anonim / dönen / geri yüklenmiş) ve **Belge yükle**. Bir belgeye tıklamak detayını açar |
| Belge detayı | Belgenin metni, türüne göre işlemler ve ilişkili belgeler (aşağıda) |
| Ad / soyad | Tespitte kullanılan sözlük: arama, tür filtresi, toplu ekleme (satır, virgül veya noktalı virgülle ayrılmış), silme ve **Sıfırla** |

Belge detayındaki işlemler ve bağlantılar türe göre değişir:

| Belge | İşlemler | Bağlantılar |
|---|---|---|
| Orijinal (PDF/DOCX) | **Anonimleştir** (sihirbaz bu sayfada açılır) | Bu orijinalden üretilen anonim belgeler |
| Anonim (DOCX/PDF) | KVKK onayı, **Üçüncü taraf export**, **Dönen belgeyi geri yükle** | Kaynak orijinal, bu belgeye dönen belgeler, belgenin anahtarları |
| Dönen (PDF/DOCX) | — | Kaynak anonim belge, ondan üretilen geri yüklenmiş belge |
| Geri yüklenmiş (PDF/DOCX) | **Geri yüklenmişi indir** | Dönen belge |

## Token’lar

Biçim: `[AD_1]`, `[SOYAD_1]`, `[TCKN_1]`, `[PLAKA_2]`, `[OZEL_1]`. Her tür kendi sayacını tutar; ad ve soyad ayrı sayılır.

- Numaralar her anonim belgede `1`’den başlar; metindeki sıraya göre verilir.
- Aynı değer bir belgede hep aynı token’ı alır. Farklı anonim belgelerde aynı kişi farklı numara taşıyabilir.
- **Özel maske** kendi adını taşıyabilir: `[XYZ]`. Köşeli parantezler zorunludur; geri yükleme token’ı metinde aradığı için parantezsiz bir ad dönen belgedeki sıradan bir kelimeyle karışırdı. Ad yalnız harf, rakam, `_` ve `-` içerir (en çok 40 karakter); başka bir anahtarın token’ıyla aynı olamaz, belgede zaten geçemez ve başka bir türün numaralı biçimini (`AD_3` gibi) taklit edemez. Yeniden numaralandırma adlı token’lara dokunmaz.

Değer kimliği (aynı kişi/değer sayılma kuralı) `src/shared/identity.ts` içindedir:

| Tür | Karşılaştırma |
|---|---|
| IBAN | Boşluk ve tire yok sayılır, büyük harf |
| Plaka | Boşluk, nokta, tire ve harf büyüklüğü yok sayılır (`34 ABC 123` = `34-abc-123`) |
| Diğerleri | Türkçe büyük/küçük harf duyarsız (`İ`, `I`, `ı` → `i`) |

## Anahtarlar ve eşleme

Bir **anahtar**, bir değer için tek kayıttır: tür, token, değer ve eşleme biçimi. Hangi yerlerin token’a çevrileceğine tek bir fonksiyon karar verir (`planSpans`, `src/main/pii/detect.ts`); hem sihirbazdaki işaretler hem üretilen belge bundan çıkar. Her satır (PDF) veya paragraf satırı (DOCX) ayrı değerlendirilir:

1. **Dedektörlerin bulduğu yerler:** Yapısal alanlar ve sözlükteki ad/soyadlar. Değer kimliği bir anahtarla eşleşirse işaretlenir; böylece bir IBAN’ın başka boşluklu yazımı da yakalanır.
2. **Anahtarın kendi değeri:** Değer, dedektör bulsun bulmasın, metinde yazıldığı her yerde aranır. Ad/soyad bütün kelime olarak (kesme ekiyle), plaka ayraçtan bağımsız, sayılar ve adresler başka bir sayının/kelimenin içinde olmayacak şekilde, özel maske düz metin olarak. Böylece elle eklenen ve dedektörün tanımadığı bir değer de değişir.
3. **Eşleme biçimi:** Ad ve soyadda **AA** (yalnız büyük harf) / **Aa** (yalnız isim yazımı) seçildiyse diğer yazımlar atlanır. Anahtarın değeri de bu yazımla saklanır (`AA` anahtarı “TÜRK”), böylece geri yükleme değiştirdiği yazımı aynen geri yazar.
4. **Kalıcı yok sayılan ifadeler:** İçlerine düşen yerler atlanır.
5. **Yok sayılan yerler:** Kullanıcının tek tek yok saydığı geçişler, satırdaki konumlarıyla ve yalnız kendi anahtarları için atlanır; bu, çakışma çözümünden önce yapılır, böylece aynı yeri başka bir anahtar alabilir. Yok sayma anahtarın değer kimliğiyle (tür + değer) saklanır, token numarasıyla değil. Konum her biçimde aynı satıra düşer: PDF’te satır sırası birebir aynıdır; DOCX’te her satır `parça#paragraf:satır` kimliği taşır ve yazıcı aynı kimliği hesaplar (metin kutularının `mc:Fallback` kopyaları asıl kutunun kararını izler). Belge üretilirken DOCX yeniden okunur ve satırlar yüklemedekiyle karşılaştırılır; uyuşmazsa belge yazılmaz.
6. **Çakışma:** Uzun eşleşme kazanır; eşit uzunlukta önce gelen.

Kalıcı yok sayılan ifadeler kullanıcıya özeldir; **Ad / soyad** sayfasının altındaki *Yok sayılan ifadeler* bölümünden de eklenip silinir.

## Kişisel veri tespiti

Tespit `src/main/pii/` altındadır. Önce yapısal alanlar bulunur, ardından bunlarla çakışmayan kelimeler ad/soyad için sınanır.

### Yapısal alanlar

- **TCKN:** `1–9` ile başlayan 11 hane; 10. ve 11. hane kontrol algoritması uygulanır.
- **VKN:** 10 hane; resmi kontrol hanesi algoritması uygulanır. Telefon veya başka alanla çakışan sayı VKN sayılmaz.
- **IBAN:** `TR` + 24 hane, araya boşluk veya tire girebilir. Metindeki yüzey biçimi korunur.
- **E-posta:** standart adres biçimi.
- **Telefon:** `+90` / `0` önekli veya öneksiz, parantez, boşluk, nokta, tire ayraçlı; toplam 10–12 hane. Daha uzun bir sayının (ör. TCKN) içinden telefon çıkarılmaz.
- **Plaka:** il kodu `01–81`, 1–3 harf (Q, W, X hariç) ve harf sayısına uygun hane uzunluğu (1 harf → 4–5 hane, 2 harf → 3–4, 3 harf → 2–3).

### Ad ve soyad

Sözlükler `resources/dicts/` altındadır ve pakete `extraResources` ile gömülür:

| Dosya | İçerik |
|---|---|
| `first-names.txt` | Adlar |
| `last-names.txt` | Soyadlar |
| `stopwords.txt` | Ad/soyad sayılmayacak kelimeler |

Her kelime tek başına sınıflanır. Kesme işaretinden sonraki ek atılır (`Ahmet’in` → `Ahmet`). Stopword’ler ve 2 harften kısa kelimeler elenir. Öncelik sırası:

1. Tamamı büyük harf ve soyad listesinde → **SOYAD**
2. Baş harfi büyük ve ad listesinde → **AD**
3. Tamamı büyük harf ve ad listesinde → **AD**
4. Baş harfi büyük ve soyad listesinde → **SOYAD**

Küçük harfle yazılmış kelime ad/soyad sayılmaz.

Kullanıcı sözlüğü hesaba bağlıdır:

- Ekrandan veya **Ad / soyad** sayfasından eklenen isimler `user_names` tablosuna yazılır.
- Hazır sözlükten silinen isimler `user_name_exclusions` tablosuna yazılır ve bir daha önerilmez. Aynı ismi yeniden eklemek onu geri getirir.
- **Sıfırla** tüm eklemeleri ve silmeleri kaldırır; liste hazır sözlüğe döner.
- Saklanan ad `Ahmet` / `AHMET` biçiminde, soyad büyük harfle tutulur.

## Güvenlik ve şifreleme

| Konu | Uygulama |
|---|---|
| Parola özeti | `scrypt` (16 bayt rastgele tuz, 64 bayt çıktı), sabit zamanlı karşılaştırma |
| Şifreleme anahtarı | Paroladan `scrypt` ile türetilen 32 bayt; kullanıcıya özel `key_salt` |
| Anahtar kaydı | AES-256-GCM, her kayıtta 12 bayt rastgele IV. Sütun içeriği `iv:tag:veri` (hex) |
| Anahtar ömrü | Yalnızca main süreç belleğinde; çıkış veya kapanışta silinir. Diske yazılmaz |
| Renderer | `contextIsolation: true`, `nodeIntegration: false`; arayüz yalnızca `window.kbms` köprüsünü görür |
| Ağ | Uygulama ağ çağrısı yapmaz |
| Sahiplik | Her klasör/belge işleminde kaydın oturumdaki kullanıcıya ait olduğu doğrulanır |

> **Önemli:** Parola sıfırlama yoktur. Parola unutulursa o hesabın anahtar kayıtları çözülemez ve anonim belgeler geri çevrilemez.

## Veri ve dosya düzeni

Uygulama verisi Electron `userData` dizinindedir: Linux’ta `~/.config/kbms`, Windows’ta `%APPDATA%\kbms`, macOS’ta `~/Library/Application Support/kbms`. Dizin adı `package.json`’daki `name` alanından gelir.

```
userData/
├─ data/kbms.sqlite                      SQLite (WAL)
└─ files/{kullanıcıId}/{klasörId}/
   ├─ {zaman}-original.{pdf|docx}        yüklenen orijinal
   ├─ {belgeId}.docx                     üretilen anonim belge
   ├─ {belgeId}.{pdf|docx}               dönen belge / geri yüklenmiş belge
   └─ ...
```

### Tablolar

| Tablo | Ne tutar |
|---|---|
| `users` | Hesap, parola özeti, anahtar tuzu |
| `folders` | Klasör (kullanıcıya bağlı) |
| `documents` | Tek dosya: rol, ad, biçim, metin, şifreli anahtarlar, dosya yolu, kaynak belge |
| `document_blocks` | Orijinal belgenin satır düzeni (metin, girinti, yazı boyu, kalınlık, hizalama, aralık, sayfa sonu) |
| `user_names` | Kullanıcının eklediği ad / soyad |
| `user_name_exclusions` | Hazır sözlükten çıkarılan ad / soyad |
| `user_ignored_phrases` | Kalıcı yok sayılan ifadeler |

Silmeler `ON DELETE CASCADE` ile ilerler: orijinal silinirse ondan üretilen anonim belgeler, dönen belgeler ve geri yüklenmiş belgeler de silinir.

### Belge rolleri

| Rol | Biçim | Ne zaman | `body` | `mapping` | `source_document_id` |
|---|---|---|---|---|---|
| `original` | PDF / DOCX | Yükleme | Boş; metin `document_blocks`’tan kurulur | Boş | Boş |
| `encoded` | DOCX / PDF | Üretilen anonim belge | Anonim metin | Şifreli anahtarlar | Orijinal |
| `returned` | PDF / DOCX | Üçüncü taraftan dönen dosya | Dönen metin | Boş | Anonim belge |
| `restored` | Dönenle aynı | Dönen metnin çözülmüş hali | Çözülmüş metin | Boş | Dönen belge |

Ekranda roller *orijinal*, *anonim*, *dönen* ve *geri yüklenmiş* olarak görünür. Bu kurallar şemada `CHECK` kısıtıyla zorlanır.

### Anahtar kaydı

Anahtarlar, anonim belgenin `documents.mapping` sütununda şifreli JSON olarak durur. Şifre çözülmüş içerik:

```json
{
  "entries": [
    { "kind": "AD", "token": "[AD_1]", "original": "Ayşe", "match": "any" }
  ]
}
```

- Kayıt belge üretilirken bir kez yazılır, sonra değişmez.
- Yalnızca o belgede onaylanan değerleri içerir; başka belgelerin anahtarlarıyla birleştirilmez.
- Geri yükleme yalnızca dönen belgenin bağlı olduğu anonim belgenin kaydını kullanır.
- Üretim yarıda kalırsa (dosya yazılamazsa) belge kaydı ve dosya geri alınır.

## Mimari

Electron üç süreç katmanıyla çalışır; derleme `electron-vite` ile yapılır.

```
src/
├─ main/                    Node tarafı (dosya, veritabanı, kripto)
│  ├─ index.ts              pencere, uygulama yaşam döngüsü
│  ├─ ipc.ts                IPC kanalları, dosya seçme/kaydetme pencereleri
│  ├─ auth.ts               hesap, oturum, bellek içi anahtar
│  ├─ crypto.ts             scrypt, AES-256-GCM
│  ├─ db.ts                 SQLite bağlantısı ve şema
│  ├─ services.ts           klasör/belge işlemleri, anonimleştirme, anahtar kaydı, geri yükleme
│  ├─ dictService.ts        kullanıcı ad/soyad sözlüğü
│  ├─ pdf.ts                pdf.js ile metin çıkarma, pdf-lib ile konumlu PDF çizme
│  ├─ ocr.ts                metin katmanı olmayan sayfaları tesseract.js ile okuma
│  ├─ pdfBlocks.ts          glif → satır → blok dönüşümü, satır parçalarının konumu
│  ├─ ooxml.ts              Word XML yardımcıları: metin parçaları, paragraflar
│  ├─ docxImport.ts         DOCX’ten satır düzeniyle metin okuma, görsel uyarıları
│  ├─ docxRewrite.ts        DOCX’i yerinde anonimleştirme/geri yükleme, temizlik
│  ├─ docxExport.ts         bloklardan DOCX üretme (PDF orijinal için)
│  └─ pii/
│     ├─ structural.ts      TCKN, VKN, IBAN, e-posta, telefon, plaka
│     ├─ names.ts           ad/soyad sınıflama
│     └─ detect.ts          tespit, anahtar üretme, token uygulama/çözme
├─ preload/                 contextBridge ile `window.kbms` API’si
├─ renderer/                React 19 + Tailwind arayüz
│  ├─ pages/                Login, Folders, FolderDetail, DocumentDetail, Names
│  ├─ components/           AppShell, EncodingWizard, TextAnnotator, KeyPanel, IgnoredPhrasesCard, ui/
│  └─ lib/                  anahtar ve belge yardımcıları
└─ shared/                  main ve renderer ortak kodu
   ├─ types.ts              tipler
   ├─ tokens.ts             token biçimi
   ├─ identity.ts           değer kimliği
   ├─ nameKeys.ts           Türkçe harf katlama, isim tarama
   └─ plates.ts             plaka ayrıştırma
resources/dicts/            ad, soyad, stopword sözlükleri
scripts/                    sözlük duman testi
tests/                      Electron içinde çalışan testler
```

### IPC API

Renderer, main sürece yalnızca `window.kbms` üzerinden erişir. Her çağrı `{ ok, data | error }` döner; köprü hatayı `Error` olarak fırlatır. Kullanıcı bir dosya penceresini iptal ederse hata metni `USER_CANCELLED` olur.

| Grup | Çağrılar |
|---|---|
| `auth` | `session`, `register`, `login`, `logout` |
| `folders` | `list`, `create`, `rename`, `delete` |
| `docs` | `list`, `get`, `upload`, `startEncoding`, `preview`, `produce`, `exportEncoded`, `restore`, `exportRestored` |
| `dict` | `list`, `add`, `remove`, `reset` |
| `ignored` | `list`, `add`, `remove` |

### Belge dönüşümü

- **PDF → metin:** `pdfjs-dist` glifleri konumlarıyla okur. Aynı satırdaki glifler (±3 pt) birleştirilir, sayfa sol kenarına göre girinti, ortalanmış satırlar, kalınlık (yüklenen yazı tipinin gerçek adından, ör. `…-BoldMT`), satır arası boşluk ve sayfa sonları çıkarılır. Her satır, aralarında boşluk olan ya da kalınlığı değişen yerlerden *parçalara* ayrılır; her parçanın x konumu ve genişliği saklanır.
- **OCR (taranmış sayfalar):** Metin katmanında 16 harften az olan sayfa taranmış sayılır. Sayfa `pdfjs-dist` ve `@napi-rs/canvas` ile 300 DPI çizilir, `tesseract.js` (WASM, ayrı bir iş parçacığında) Türkçe + İngilizce dil verisiyle okur. Dil verisi (`resources/tessdata`, tessdata_fast) uygulamayla paketlenir; hiçbir şey indirilmez. Her tanınan kelime, satırının taban çizgisine göre PDF noktasına çevrilip metin katmanından gelen glifler gibi satırlara birleştirilir; bu yüzden tespit ve konumlu PDF çıktısı aynen çalışır. Güveni %30’un altındaki kelimeler atılır. Konumlu PDF çıktısı görselleri kopyalamadığı için taranmış görüntü anonim belgeye geçmez.
- **DOCX → metin:** `jszip` ile paket açılır, XML `@xmldom/xmldom` ile okunur. Gövde, üst/alt bilgi, dipnot, sonnot ve yorum parçaları sırayla gezilir; tablo hücreleri, köprüler, içerik denetimleri, metin kutuları ve izlenen eklemeler okunur, izlenen silmeler atlanır. Hizalama, sol girinti, paragraf sonrası boşluk, sayfa sonu, yazı boyu ve kalınlık doğrudan biçimlendirmeden alınır; boş paragraflar önceki satırın altına boşluk olarak eklenir. Bir kelime Word’de birden çok parçaya bölünmüş olsa da tek metin olarak birleşir.
- **Metin → DOCX (PDF orijinal, DOCX çıktı):** `docx` kütüphanesi her bloğu Calibri yazı tipiyle, girinti, hizalama ve aralığı koruyarak bir paragraf yapar. Asıl sayfa yerleşimi birebir kopyalanmaz.
- **Konumlu PDF (PDF orijinal, PDF çıktı; dönen PDF’in geri yüklenmesi):** `pdf-lib` özgün sayfa boyutlarında sayfalar açar ve her satır parçasını özgün x/y konumuna, yazı boyuna ve kalınlığına göre çizer. Yazı tipi `pdfjs-dist` ile gelen Liberation Sans (normal/kalın) olup `@pdf-lib/fontkit` ile alt küme olarak gömülür; Türkçe karakterler korunur.

### Biçimin korunması

Token’lar her zaman **satırın/paragrafın tamamında** bulunur; böylece telefon, IBAN, plaka gibi birden çok parçaya yayılan değerler de kaçmaz. Bulunan değişiklik sonra satırı oluşturan parçalara dağıtılır: token, değişikliğin değdiği ilk parçaya yazılır, değerin kalanı diğer parçalardan silinir. Her parça kendi biçimini veya konumunu korur.

**DOCX (yerinde):** Özgün paket açılır, yalnızca metin düğümleri (`w:t`) değişir; yazı tipi, renk, stil, tablo, liste, görsel ve sayfa yapısı aynen kalır. İşlenen yerler:

| Nerede | Ne yapılır |
|---|---|
| Gövde, üst/alt bilgi, dipnot, sonnot, yorum, metin kutusu, yapı taşları | Metin anonimleştirilir |
| Alan kodları (`HYPERLINK "mailto:…"` vb.), köprü adresleri | Anonimleştirilir |
| İzlenen değişiklikler | Kabul edilir: silinen metin ve biçim geçmişi tamamen kaldırılır |
| Revizyon/yorum yazarları, `people.xml` | `Anonim` olur |
| Belge özellikleri (yazar, son düzenleyen, başlık, konu, açıklama, anahtar kelimeler, şirket, yönetici, özel özellikler) | Temizlenir |
| Şablon yolu, belge değişkenleri | Kaldırılır |
| İçerik denetimi veri bağları (`customXml`) | Bağ kaldırılır, veri anonimleştirilir |
| İlk sayfa küçük resmi (`docProps/thumbnail`) | Silinir |

Dönen DOCX’in geri yüklenmesi aynı motoru temizlik yapmadan kullanır; üçüncü tarafın biçimi korunur ve Word token’ı birden çok parçaya bölmüş olsa da çözülür.

**PDF (konumlu):** Satır parçaları özgün yerlerine çizilir; sütunlar, girintiler, iki yana yaslı metnin aralıkları ve kısmi kalınlık korunur. Token, yerine geçtiği metinden genişse o parça sığacak kadar (en çok %60’a) küçültülür.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme (hot reload) |
| `npm run build` | Production derlemesi → `out/` |
| `npm run preview` | Derlenmiş uygulamayı aç |
| `npm run typecheck` | Main/preload ve renderer için TypeScript kontrolü |
| `npm run smoke` | Sözlük duman testi |
| `npm test` | Testler (bkz. [Testler](#testler)); `npm test -- yok` yalnız adında “yok” geçenleri çalıştırır |
| `npm run pack` | Kurulumsuz paket (dizin) |
| `npm run dist` | Mevcut platform için paket |
| `npm run dist:linux` | AppImage / deb / rpm |
| `npm run dist:win` | NSIS kurulum + portable (x64) |
| `npm run dist:mac` | dmg + zip (x64, arm64), imzasız |
| `npm run dist:all` | Üç platform |

Duman testi (`scripts/smoke-dicts.mjs`) Electron olmadan çalışır; sözlük dosyalarının yüklendiğini ve Türkçe harf katlamanın doğru olduğunu denetler.

## Testler

```bash
npm test               # hepsi
npm test -- pdf        # dosya veya test adında "pdf" geçenler
```

Testler `tests/` altındadır ve ekransız Electron’da (`--ozone-platform=headless`) çalışır; `better-sqlite3` Electron için derlendiğinden düz Node ana süreç kodunu yükleyemez. `tests/run.mjs` her `*.test.ts` dosyasını esbuild ile tek dosyaya paketler (`out/tests/`), Electron’u başlatır, başarısızlıkta 1 ile çıkar.

- Her test kendi yeni kullanıcısıyla, geçici bir veri dizininde çalışır; kalıcı yok sayılan ifadeler ve sözlük eklemeleri testler arasında taşınmaz.
- Test belgeleri kodla üretilir (`docx` ile DOCX, `pdf-lib` ile konumlu PDF); repo dışı dosya gerekmez. `sample.test.ts` yalnız `ornek-dosyalar/` içindeki örnek iddianame varsa çalışır, yoksa atlanır.

| Dosya | Ne korur |
|---|---|
| `detect.test.ts` | Yapısal tespit (TCKN’nin telefon sanılmaması dahil), parçalara dağıtma, geri yükleme sırası, özel token adı kuralları |
| `docx.test.ts` | DOCX’in her köşesinde (gövde, üst/alt bilgi, dipnot, yorum, metin kutusu, köprü, özellikler, silinmiş revizyon) özgün değer kalmaması; biçim, tablo, görselin korunması; dönen DOCX’in geri yüklenmesi; belge ilişkileri |
| `pdf.test.ts` | PDF’in sütun parçaları ve kalınlıkla okunması; konumlu PDF’te yerleşim ve Türkçe harfler; PDF’ten DOCX; geri yükleme; hatalı dosyaların reddi |
| `review.test.ts` | Önizleme = çıktı; konum ve anahtar bazlı yok sayma; AA / Aa / AA/Aa ve varsayılanlar; kalıcı ifadeler; özel token adları; hatalı girdilerin reddi |
| `sample.test.ts` | Gerçek bir belgede önizleme = çıktı, sayfa ve satır sayısı, geri yükleme |

Push ve pull request’lerde `.github/workflows/test.yml` tip denetimi, duman testi ve testleri çalıştırır. Sürüm iş akışı da paketlemeden önce Linux’ta testleri çalıştırır; başarısız olursa sürüm yayımlanmaz.

## Paketleme ve sürüm

Paket çıktıları `release/` altına yazılır. `.github/workflows/release.yml`:

- `v*` biçiminde bir etiket push’landığında veya elle (`workflow_dispatch`) tetiklenir.
- Ubuntu, Windows ve macOS üzerinde ayrı ayrı `npm ci` + `dist:*` çalıştırır ve çıktıları artifact olarak yükler.
- Etiketle tetiklendiyse tüm çıktılarla bir GitHub Release oluşturur.

```bash
git tag v0.1.0
git push origin v0.1.0
```

macOS paketleri imzasızdır (`identity: null`).

**Linux’ta Windows paketi** (`npm run dist:win`) wine ile üretilir. NSIS ve `rcedit` 32 bitlik araçlar olduğu için **`wine32:i386`** gerekir; devcontainer Dockerfile’ı bunu kurar. Elle kurulum:

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update
sudo apt-get install wine32:i386
```

wine ayar klasörü (`~/.wine`) 32 bit desteği olmadan oluşmuşsa `kernel32.dll` hatası verir; klasörü kaldırıp `wineboot --init` ile yeniden oluşturun. CI’da Windows paketi `windows-latest` üzerinde wine olmadan üretilir.

## Bilinen sınırlar

- **OCR yaklaşıktır.** Taranmış sayfalarda tanıma hataları (ör. `0`/`O`, `1`/`l`) TCKN, IBAN gibi değerlerin doğrulamasını bozup tespit edilmemelerine yol açabilir; kalınlık okunmaz. Kötü taranmış, eğik veya el yazısı sayfalar zayıf okunur. OCR sayfa başına birkaç saniye sürer. DOCX içindeki görseller OCR’dan geçmez.
- **Görseller ve gömülü nesneler taranmaz.** DOCX’teki resimlerin içindeki yazılar ve gömülü dosyalar anonim belgede aynen kalır; sihirbaz bunun için uyarı gösterir. Eski `.doc` desteklenmez.
- **Sözlük tabanlı ad tespiti.** Sözlükte olmayan isimler ve küçük harfle yazılmış isimler bulunmaz; sağ tık veya **Ad / soyad** sayfasından eklenmelidir. Sözlükteki her kelime (ör. *Türk*, *Güneş*) bağlamdan bağımsız ad/soyad sayılabilir; gereksizse listeden kaldırılmalıdır.
- **Yok sayılan yerler bu anonimleştirmeye özeldir.** Aynı orijinalden yeniden anonimleştirmede tekrar seçilmeleri gerekir; kalıcı olan yalnız *her zaman yok sayılan ifadeler*dir.
- **AA/Aa anahtarında geri yükleme yazımı birleştirir.** Her yazımı değiştiren bir anahtar, geri yüklemede tek bir yazım yazar (“Ayşe Türk” → `[SOYAD_1]` → “Ayşe TÜRK”). AA ve Aa anahtarlarında bu olmaz.
- **PDF’ten üretilen çıktılar yaklaşıktır.** Konumlu PDF’te görseller, çizgiler, tablo kenarlıkları ve özgün yazı tipi yoktur (metin Liberation Sans ile çizilir). PDF’ten üretilen DOCX satır düzenini korumaya çalışır; tablo ve sütunlar aslına uygun aktarılmaz.
- **Konumlu PDF’te yazı tipi kapsamı.** Latin, Yunan ve Kiril dışındaki yazı sistemleri (CJK, emoji vb.) yazı tipinde bulunmadığı için boş kutu olarak görünür.
- **Token’ların korunması gerekir.** Üçüncü taraf token’ları değiştirir veya bölerse (`[AD_ 1]` gibi) o yerler çözülmez.
- **Parola kurtarma yok.** Bkz. [Güvenlik ve şifreleme](#güvenlik-ve-şifreleme).

## Geliştirme kuralları

Proje geliştirme aşamasındadır ve geriye dönük uyumluluk tutulmaz (`.cursor/rules/no-legacy.mdc`):

- Yalnızca güncel biçim yazılır ve okunur. Örneğin token `[AD_1]` biçimindedir; `AD_1` tanınmaz.
- Eski kayıtları dönüştüren migrasyon veya ikinci bir kod yolu eklenmez. Uygulama yalnızca güncel şemayı kurar (`CREATE TABLE IF NOT EXISTS`); eski bir şema tanınmaz ve dönüştürülmez. Şema değiştiğinde geliştirme verisi silinmelidir (bkz. aşağıda).

Veriyi sıfırlamak için uygulamayı kapatıp `userData` dizinini silin (Linux’ta `~/.config/kbms`, Windows’ta `%APPDATA%\kbms`, macOS’ta `~/Library/Application Support/kbms`).
