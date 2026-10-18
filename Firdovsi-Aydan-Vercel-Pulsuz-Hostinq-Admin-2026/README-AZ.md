# Firdovsi & Aydan — Vercel üçün toy saytı

Bu paket **Vercel** üçün hazırdır: kökdə `index.html`, `admin.html`, `vercel.json` və `api/site.js` yerləşir. **PHP yoxdur.** `npm build` tələb edilmir. Açılış səhifəsi və admin interfeysi Vercel-də statik yerləşir; məlumatları saxlamaq üçün Vercel Function + Upstash Redis REST işləyir.

## Əvvəlki 404 xətası niyə yaranırdı?
Əvvəlki ZIP PHP / adi cPanel üçün nəzərdə tutulmuşdu. Vercel PHP fayllarını standart olaraq işə salmır və `index.php` saytın giriş səhifəsi sayılmır. Burada `index.html` var, `/admin` yolu `vercel.json` vasitəsilə `/admin.html` səhifəsinə yönəldilir.

## 1. Vercel-ə yerləşdirin

1. ZIP-i kompüterinizdə **çıxarın (Extract)**. İçindəki `index.html`, `admin.html`, `vercel.json`, `assets/`, `api/` birbaşa layihənin kökündə qalmalıdır. **ZIP-in özünü GitHub-a tək fayl kimi yükləməyin.**
2. GitHub-da yeni repository açın və həmin faylları repository-nin kökünə yerləşdirin (istəsəniz Vercel CLI ilə də yerləşdirə bilərsiniz).
3. Vercel → **Add New → Project** → GitHub repository-nizi import edin.
4. **Framework Preset: Other** seçin. **Root Directory: `./`**, Build Command: **boş**, Output Directory: **boş** (override etməyin); `vercel.json` avtomatik götürülür.
5. **Deploy** düyməsini basın. Sayt `https://layihe-adiniz.vercel.app/`, admin isə `https://layihe-adiniz.vercel.app/admin` ünvanında açılacaq.

**Qeyd:** İlk deploy zamanı saytın görünməsi üçün verilənlər bazası tələb olunmur. Lakin qonaq axtarışı və admin siyahısının işləməsi üçün aşağıdakı 2-ci mərhələ vacibdir.

## 2. Qonaq məlumatlarının Vercel-də saxlanması

Vercel Function serverləri müvəqqətidir. `storage/`, `data.json`, lokal SQLite, PHP sessiyası kimi fayllarda saxlamaq olmaz: növbəti request və ya deploy zamanı məlumatlar itib gedə bilər. Ona görə **Upstash Redis** istifadə edilir.

1. https://upstash.com/ saytında hesab yaradıb **Redis database** yaradın.
2. Upstash Redis verilənlər bazasının **REST URL** və **REST TOKEN** məlumatlarını götürün (hər ikisini gizli saxlayın).
3. Vercel → layihə → **Settings → Environment Variables** bölməsində əlavə edin:

   `UPSTASH_REDIS_REST_URL` → Upstash-da verilən `https://...upstash.io` URL
   
   `UPSTASH_REDIS_REST_TOKEN` → Upstash REST token (**Read-only deyil, standart token**)
   
   `ADMIN_SETUP_KEY` → özünüzün yaratdığınız, **ən azı 12 simvol** uzunluğunda gizli quraşdırma kodu (məsələn, parol menecerində yaradın).

4. Bu dəyişənləri **Production** mühitinə verin. **Redeploy** edin (Environment Variables əlavə edildikdən sonra yeni deployment lazımdır).
5. İlk quraşdırmadan sonra Upstash verilənlər bazasını **silməyin**; məlumatlar yalnız sizin Redis bazanızda qalır. Sayt ünvanının sonuna `/admin` yazın. Birinci dəfə **İlk admin parolu** formu açılacaq. İlk parolunuzu (10+ simvol) və Vercel-dəki `ADMIN_SETUP_KEY` kodunu yazın. Bu ilk parol serverdə PBKDF2 hash formasında saxlanır, sonradan digər şəxs yeni parol qura bilməz.
6. Admin paneldə ad və masa əlavə edin, CSV ilə toplu yükləyin, ad və masa nömrəsini redaktə edin, gəlib-gəlməmə işarələyin. Ziyarətçilər əsas səhifədə ad yazıb masa tapa bilərlər.

**Təhlükəsizlik:** Redis REST token və ADMIN_SETUP_KEY heç vaxt `index.html` və ya brauzer JavaScript-ə əlavə edilməməlidir. Bunlar yalnız Vercel Environment Variables-də saxlanmalıdır. Təhlükəsiz sessiya `HttpOnly`, `Secure`, `SameSite=Strict` cookie ilə qorunur; admin dəyişikliklərində CSRF yoxlanır. Admin parolu yalnız bir dəfə quraşdırılır.

## 3. Domen əlavə edin

Vercel → Project → **Settings → Domains** → domeninizi əlavə edin. Vercel DNS üçün lazım olan A/CNAME qeydlərini göstərəcək. Domen aldığınız şirkətin DNS panelində **Vercel-də göstərilən dəqiq qeydləri** yazın, ardından SSL aktivləşməsini gözləyin. Domen almadan əvvəl `vercel.app` ünvanında test edin.

## 4. Problem yaranarsa

- **404 NOT_FOUND:** GitHub repo-nun kökündə `index.html` olduğunu və Vercel Root Directory seçiminin `./` olduğunu yoxlayın. Köhnə PHP layihəsinə deploy etməyin.
- **Admin səhifəsində database xətası:** `UPSTASH_REDIS_REST_URL` və `UPSTASH_REDIS_REST_TOKEN` Production-a əlavə edilibmi? Redeploy edilibmi?
- **Quraşdırma kodu yanlışdır:** `ADMIN_SETUP_KEY` Vercel-də verdiyiniz dəyər ilə formadakı dəyər eyni olmalıdır.
- **Parol artıq təyin edilib:** Redis-dəki admin qeydini avtomatik sıfırlamayın; mövcud parolla daxil olun. Zəruri reset yalnız sahiblik təsdiqi ilə Redis-in təhlükəsiz administrasiya vasitəsilə edilməlidir.
- **Saytın görünməsi:** əsas səhifə məzmunu statikdir, qonaq axtarışı işlətmək üçün database mütləq qoşulmalıdır.
- **`/api/site?action=status`** API-ni yoxlamaq üçün açın: düzgün quraşdırmada JSON status qaytarır; 503 cavabı env dəyişənlərinə işarə edir.

## Layihə strukturunun qısa təsviri

- `index.html` – qonaq qarşılama, adla masa axtarışı
- `admin.html` – admin girişi və siyahı idarəetməsi
- `assets/style.css` – mobil və masaüstü premium dizayn
- `assets/app.js` – istifadəçi interfeysi
- `assets/wedding-flowers.webp` – lokal dekorativ gül təsviri
- `api/site.js` – Vercel serverless API, admin autentifikasiya və Redis əməliyyatları
- `vercel.json` – Vercel marşrutları, təhlükəsizlik başlıqları

**Bu ZIP-i başqa platformalara yükləmək üçün əlavə çevirmə lazım ola bilər.**

## 5. Təhlükəsiz başlanğıc və yoxlama

- Şəxsi domen almaq **məcburi deyil**. Vercel sizə pulsuz `layihe-adiniz.vercel.app` ünvanı verir. Toy məclisi üçün kiçik şəxsi layihədə Vercel Hobby və Upstash Free limitlərini izləyin.
- Vercel ödənişsiz planı yalnız şəxsi/qeyri-kommersiya istifadə üçün nəzərdə tutulur.
- Upstash Free limitləri dəyişə bilər. Qonaq axtarışlarının sayı artarsa limit aşılmasını yoxlayın.
- ZIP-də verilənlər bazası açarı, real admin parolu və ya hazır bulud verilənlər bazası yoxdur. Bazanı **öz hesabınızda** yaradıb açarlarını Vercel-ə əlavə etməlisiniz.
- Test üçün `/api/site?action=status` səhifəsini açın. `initialized: false` olması ilk parolun hələ yaradılmadığı deməkdir. 503 olanda mühit dəyişənlərini yoxlayın.
- CSV ixracı əvvəlki qonaq siyahısının ehtiyat nüsxəsini çıxarmaq üçündür. Faylı ayrıca təhlükəsiz yerdə saxlayın.
- GitHub-a göndərərkən ZIP-i **açın**, yalnız içindəkiləri repo kökünə yerləşdirin. `api/`, `assets/`, `index.html`, `admin.html`, `vercel.json` eyni səviyyədə olmalıdır.

## 6. Nələr pulsuzdur?

Vercel-də Hobby planı və Upstash Redis Free planı öz limitləri daxilində ödənişsizdir. Domen istəyirsinizsə ayrıca domain satıcısından alınır, amma domen almadan da `*.vercel.app` linkiniz işləyəcək. Kodları Vercel-ə yükləmək özü **canlı yerləşdirmə demək deyil** — şəxsi Vercel və Upstash hesablarınızda bir dəfə quraşdırmalısınız.
