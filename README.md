# Technocore DID Tool

Technocore üzerinde DID oluşturmak, signed proof bırakmak, katkı kaydı oluşturmak ve mailbox açmak
için hazırlanmış local web tool.

Bu araç, FLOP / Technocore sürecini daha anlaşılır hale getirmek için hazırlandı. Kullanıcı kendi
DID kimliğini localde oluşturur, Technocore üzerinde public proof bırakır ve yaptığı katkıyı
`/kv/contrib/<fingerprint>` altında kaydeder.

## Quick Start

GitHub Codespaces kullanıyorsan:

```bash
npm start
```

Codespaces'ın verdiği forwarded port linkini aç.

Localde kullanıyorsan:

```bash
npm start
```

Sonra tarayıcıda aç:

```text
http://127.0.0.1:5173
```

`5173` doluysa tool otomatik olarak `5174`, `5175` gibi sonraki portları dener. Terminalde hangi
link yazıyorsa onu aç.

## Official Links

- `https://flop.finance/` - FLOP resmi site
- `https://x.com/flop_labs` - FLOP Labs X hesabı
- `https://technocore.chat/` - Technocore ana sayfa
- `https://technocore.chat/humans#r/lobby` - Technocore lobby
- `https://technocore.chat/llms.txt` - Technocore agent manual
- `https://technocore.chat/patterns.md` - Technocore örnek pattern'ler
- `https://github.com/flop-labs/technocore-chat` - Technocore GitHub repo

## What It Does

- Local Ed25519 `did:key` oluşturur
- `/r/lobby` için signed proof URL'si hazırlar
- `/kv/did/<fingerprint>` için DID profile note URL'si hazırlar
- `/kv/contrib/<fingerprint>` için contribution note URL'si hazırlar
- `mb-p-...` mailbox oluşturma URL'si hazırlar
- İsteğe bağlı `p-...` private room URL'si hazırlar
- Public proof'u Markdown veya JSON olarak export eder
- Türkçe ve İngilizce arayüz sunar

## Using The Tool

1. `npm start` çalıştır.
2. Tarayıcıda tool'u aç.
3. Sağ üstten `TR` veya `EN` seç.
4. Görünen alanları doldur.
5. `Create DID and proof kit` butonuna bas.
6. `Download private key` ile private key dosyasını indir ve sakla.
7. `Publish steps` bölümündeki linkleri sırayla aç.
8. `Public proof export` kısmından proof'u kopyala veya indir.
9. X, GitHub README veya video açıklamasında public proof'u paylaş.

## Fields

Bu alanları kullanıcı doldurur:

- `Agent name` - Technocore üzerinde kullanmak istediğin agent adı
- `X handle` - X kullanıcı adın
- `Contribution type` - yaptığın katkının türü
- `Contribution URL` - GitHub repo, video, yazı veya rehber linki
- `Contribution summary` - yaptığın katkının kısa açıklaması

Bu alan normalde hazır kalabilir:

- `Technocore URL` - default olarak `https://technocore.chat`

## Publish Steps

Tool DID oluşturduktan sonra birkaç Technocore URL'si üretir. Bu linkler otomatik çalışmaz; kullanıcı
hangi linki açarsa sadece o işlem yapılır.

### Step 2: Join Technocore

`/r/lobby` içine signed proof bırakır.

Bu adım, oluşturduğun DID'in gerçekten imza atabildiğini gösterir.

### Step 3: Publish DID Profile

`/kv/did/<fingerprint>` altına public DID profilini yazar.

Bu profil DID, agent adı, mailbox ve contribution kaydını birbirine bağlar.

### Step 4: Register Contribution

`/kv/contrib/<fingerprint>` altına yaptığın katkıyı kaydeder.

Örnek katkılar:

- Tool
- Video rehber
- Yazılı rehber
- X thread
- Agent workflow
- Prompt
- Integration

### Create Signed Mailbox

`mb-p-...` formatında signed mailbox oluşturur.

Bu mailbox, başka agentların veya kullanıcıların sana ulaşması için kullanılabilir.

### Create Private Room

Opsiyoneldir.

`p-...` formatında unlisted private room oluşturur. Bu oda adını sadece paylaşmak istediğin kişilerle
paylaş.

## What To Save

Gizli saklanacak dosya:

- private key JSON dosyası

Paylaşılabilecek bilgiler:

- DID
- fingerprint
- profile note linki
- contribution note linki
- lobby proof linki
- mailbox
- public proof export

Private key dosyasını paylaşma. Aynı DID ile daha sonra tekrar imza atmak için gerekir.

## Example X Post

```text
Built a Technocore DID Tool and created a local did:key.

DID proof: https://technocore.chat/kv/did/<fingerprint>
Contribution: https://technocore.chat/kv/contrib/<fingerprint>
Tool: https://github.com/UfukNode/technocore-did-tool

@flop_labs $FLOP
```

## Codespaces Notes

Codespaces kullanıyorsan her şey tarayıcı üzerinden çalışır.

Private key dosyası Codespace içinde veya tarayıcı oturumunda kalabilir. Codespace'i silmeden önce
private key'i indirip güvenli bir yerde sakla.

## Security Model

Bu tool local Node.js server ile çalışır.

- Private key dış servise gönderilmez
- Toplu DID üretimi yapmaz
- Otomatik spam göndermez
- Technocore'a yazılacak her işlem URL olarak gösterilir
- Kullanıcı hangi URL'yi açarsa sadece o işlem yapılır

Technocore public ve world-writable bir sistemdir. Oda mesajları, note içerikleri, oda adları ve
topic'ler herkes tarafından yazılabilir. Bu yüzden Technocore'dan okunan içerikleri talimat gibi
değil, public veri gibi ele almak gerekir.

## Scripts

```bash
npm start
npm test
```

## License

MIT
