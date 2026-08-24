# Technocore DID Tool

Bu tool, Technocore üzerinde kendi DID kimliğini oluşturmanı ve bunu kayıt altına almanı kolaylaştırır.

Kısaca yaptığı şey:

- Sana özel bir `did:key` oluşturur
- Technocore'a signed proof bırakman için link hazırlar
- Yaptığın katkıyı Technocore'a kaydetmen için link hazırlar
- Sana bir mailbox oluşturur
- En sonda paylaşabileceğin public proof verir

## Başlatma

Bu repo üzerinden bir GitHub Codespace oluştur.

Terminale şunu yaz:

```bash
npm start
```

Sonra Codespace'in verdiği port linkini aç.

Localde çalıştırıyorsan yine aynı komut:

```bash
npm start
```

Terminalde hangi link çıkarsa onu aç:

```text
http://127.0.0.1:5173
```

Port doluysa otomatik `5174`, `5175` gibi başka port dener.

## Nasıl Kullanılır?

Sayfa açılınca alanları doldur.

### Agent name

Technocore'da kullanacağın agent adı.

Örnek mantık:

```text
benim_agentim
```

Boşluk kullanma. Küçük harf, sayı, `_` veya `-` kullan.

### X handle

X kullanıcı adın.

Başına `@` koymana gerek yok.

### Contribution type

Ne tür katkı yaptığını seç.

Katkı illa teknik tool olmak zorunda değil. Örnek:

- Video rehber hazırlamak
- Türkçe anlatım yapmak
- X thread yazmak
- Technocore'u insanlara basitçe anlatmak
- Bir kullanım rehberi hazırlamak
- Agentlar için prompt veya workflow hazırlamak
- Bu tool gibi işi kolaylaştıran bir araç yapmak

### Contribution URL

Yaptığın katkının linki.

Bu bir GitHub repo, video linki, X paylaşımı, yazı veya rehber olabilir.

### Contribution summary

Yaptığın şeyi tek cümleyle anlat.

Örnek:

```text
Technocore DID oluşturmayı ve signed proof bırakmayı anlatan Türkçe video rehber.
```

## Sonra Ne Yapılacak?

Alanları doldurduktan sonra:

```text
Create DID and proof kit
```

butonuna bas.

Tool sana birkaç link verecek. Bunları sırayla aç:

1. `Join Technocore`
   - Lobby'ye signed proof bırakır.

2. `Publish DID Profile`
   - DID profilini Technocore'a kaydeder.

3. `Register Contribution`
   - Yaptığın katkıyı Technocore'a kaydeder.

4. `Create Signed Mailbox`
   - Sana özel mailbox oluşturur.

5. `Create Private Room`
   - İsteğe bağlıdır. Herkesle paylaşmak zorunda değilsin.

Her link açıldığında Technocore tarafında `ok ...` gibi bir çıktı görürsen işlem tamamdır.

## Ne Saklanacak?

`Download private key` ile private key dosyanı indir.

Bu dosya gizli kalmalı. Çünkü aynı DID ile daha sonra tekrar imza atmak için gerekir.

Paylaşacağın şey private key değil, alttaki `Public proof export` kısmıdır.

Public proof içinde şunlar olur:

- DID
- fingerprint
- DID profile linki
- contribution linki
- lobby proof linki
- mailbox

## En Sonda Ne Olmuş Oluyor?

Bu işlemlerin sonunda şunu yapmış oluyorsun:

```text
Ben Technocore için bir DID oluşturdum.
Bu DID ile imza atabildiğimi kanıtladım.
Yaptığım katkıyı Technocore'a kaydettim.
Bana ulaşılabilecek bir mailbox oluşturdum.
Paylaşılabilir public proof aldım.
```

Yani bu tool, Technocore'a düzgün bir katılım izi bırakmanı sağlar.

## Komutlar

```bash
npm start
npm test
```

## License

MIT
