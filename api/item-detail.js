// Vercel Serverless Function：伺服器端渲染 item-detail.html（商品頁）
//
// 跟 api/article.js 同一套做法、同一組理由，差別只在資料源是 site-data.json +
// scores-data.json，而不是 articles.json。
//
// 為什麼需要這個：商品頁原本是純前端渲染，原始 HTML 的 <title> 固定是
// 「Glow Makeup | 商品詳情」、description 固定是「Glow Makeup 真實社群美妝評分與心得彙整。」、
// og:image 全空、H1 是「商品名稱」四個字。304 個品項的網址都不一樣，但不執行 JS 時
// 拿到的是同一份 HTML。這會造成：
//   1. 不執行 JS 的爬蟲與社群分享卡片產生器（LINE／Threads／Facebook）看到的 303 個
//      商品頁標題完全相同，等於整批商品頁在它們眼中是重複內容
//   2. Google 雖然會執行 JS，但要排到「渲染」那一關才看得到真正的標題與內容
//   3. Product schema（含 aggregateRating 星等）同樣要等 JS 才寫進去
//
// ⚠️ 範本檔名刻意不叫 item-detail.html：Vercel 的 rewrites 是在「檔案系統比對之後」
// 才執行的，只要根目錄存在同名的 item-detail.html，請求就會被那個靜態檔直接接走，
// rewrite 永遠不會觸發。這個坑 article.html 踩過一次（SSR 自 3187a1f 上線起從未生效，
// 2026-10-06 才查出），詳見 api/article.js 的註解。把範本改名之後 /item-detail.html
// 在檔案系統查無對應，rewrite 才會把請求交給這支 function——網址完全不變，站內連結、
// sitemap.xml 裡那 303 個網址、GSC 已收錄的網址都不用動。
//
// 瀏覽器載入後 item-detail.template.html 裡原本的 CSR 邏輯還是會照跑一次（重新渲染
// 同一份內容），純粹是多一次冪等的 DOM 更新，也是這支 function 出錯時的安全網。
//
// 任何一步出錯都 fallback 回傳「未經改寫的原始靜態範本」，行為等同加這支 function
// 之前的現況（讓 CSR 補內容），而不是讓商品頁掛掉、比現況更差。

const fs = require('fs');
const path = require('path');

const SITE = 'https://www.theglowmakeup.org';

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function readTemplate() {
    return fs.readFileSync(path.join(process.cwd(), 'item-detail.template.html'), 'utf-8');
}

// site-data.json 約 350KB、scores-data.json 約 744KB，每次請求都重新 parse 一次
// 是白花的時間。這兩份檔案是 build 時用 includeFiles 打包進 function 的，在同一個
// 執行實例的生命週期內不可能改變（要改就得重新部署、換新實例），所以直接快取在
// module scope 很安全，不會讀到過期資料。
const jsonCache = new Map();
function readJson(file) {
    if (!jsonCache.has(file)) {
        jsonCache.set(file, JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf-8')));
    }
    return jsonCache.get(file);
}

// 跟 item-detail.template.html 裡 DOMContentLoaded 的查找方式一致：
// 走訪 subcategoryDetails 的每個子分類，用 name 去頭尾空白後比對。
// （已確認 site-data.json 的 304 個品項名稱全站唯一，不會比對到兩筆）
function findItem(siteData, itemName) {
    const target = String(itemName || '').trim();
    if (!target) return null;
    const details = (siteData && siteData.subcategoryDetails) || {};
    for (const [subName, subDetail] of Object.entries(details)) {
        const items = subDetail && subDetail.items;
        if (!Array.isArray(items)) continue;
        const found = items.find((it) => String(it.name || '').trim() === target);
        if (found) return { item: found, subcategoryName: subName };
    }
    return null;
}

function absoluteImage(raw) {
    if (!raw) return '';
    try {
        return new URL(raw, SITE + '/').href;
    } catch (err) {
        return '';
    }
}

function renderItemHtml(template, item, subcategoryName, scoreEntry) {
    const fullName = `${item.brand} ${item.name}`;
    const title = `${fullName} | Glow Makeup`;
    // 跟 CSR 的 seoDesc 用同一句，兩邊要一起改
    const desc = `${fullName} — Glow Makeup 真實社群評分與網友心得，購物不踩雷。`;
    const canonical = `${SITE}/item-detail.html?item=${encodeURIComponent(item.name)}&from=board`;
    const image = absoluteImage(item.image || item.img);

    const crumbs = [
        ['首頁', `${SITE}/`],
        ['熱門美妝看板', `${SITE}/board-landing.html`],
    ];
    if (subcategoryName) {
        crumbs.push([
            subcategoryName,
            `${SITE}/detail.html?sub=${encodeURIComponent(subcategoryName)}&from=board`,
        ]);
    }
    crumbs.push([item.name, canonical]);

    const breadcrumbSchema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({
            '@type': 'ListItem', position: i + 1, name: c[0], item: c[1],
        })),
    });

    // Product schema：只在真的有真實評分資料時才加 aggregateRating。
    // 沒有評分的品項不能捏造星等，寧可不輸出 schema 也不要塞假資料——
    // 這條規則跟 CSR 那邊是同一條，不要只改一邊。
    let productSchemaTag = '<script type="application/ld+json" id="schema-jsonld"></script>';
    if (scoreEntry && scoreEntry.composite != null && scoreEntry.mentions) {
        const productSchema = {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: fullName,
            image: image || undefined,
            brand: { '@type': 'Brand', name: item.brand },
            url: canonical,
            aggregateRating: {
                '@type': 'AggregateRating',
                ratingValue: scoreEntry.composite,
                reviewCount: scoreEntry.mentions,
                bestRating: 5,
                worstRating: 1,
            },
        };
        productSchemaTag =
            `<script type="application/ld+json" id="schema-jsonld">${JSON.stringify(productSchema)}</script>`;
    }

    let html = template;

    const swap = (needle, replacement) => {
        if (!html.includes(needle)) {
            // 範本被改過、對不上了：丟出去讓 module.exports 的 catch 回退原始範本，
            // 不要靜默送出一份只改到一半的 HTML
            throw new Error(`item-detail 範本找不到待取代片段: ${needle.slice(0, 60)}`);
        }
        html = html.replace(needle, replacement);
    };

    swap('<title>Glow Makeup | 商品詳情</title>', `<title>${escapeHtml(title)}</title>`);
    swap(
        'id="canonical-link" href="https://www.theglowmakeup.org/board-landing.html">',
        `id="canonical-link" href="${escapeHtml(canonical)}">`
    );
    swap(
        'id="og-url" content="https://www.theglowmakeup.org/">',
        `id="og-url" content="${escapeHtml(canonical)}">`
    );
    swap(
        'id="meta-description" content="Glow Makeup 真實社群美妝評分與心得彙整。">',
        `id="meta-description" content="${escapeHtml(desc)}">`
    );
    swap(
        'id="og-title" content="Glow Makeup | 商品詳情">',
        `id="og-title" content="${escapeHtml(title)}">`
    );
    swap(
        'id="og-description" content="Glow Makeup 真實社群美妝評分與心得彙整。">',
        `id="og-description" content="${escapeHtml(desc)}">`
    );
    swap('id="og-image" content="">', `id="og-image" content="${escapeHtml(image)}">`);
    swap('<script type="application/ld+json" id="schema-jsonld"></script>', productSchemaTag);
    swap(
        '<script type="application/ld+json" id="breadcrumb-jsonld"></script>',
        `<script type="application/ld+json" id="breadcrumb-jsonld">${breadcrumbSchema}</script>`
    );

    // 可見內容：品牌、商品名（H1）、商品圖、產品特點。
    // 商品特點只寫 site-data.json 真的有的 desc（已確認 304 個品項全部都有自己的一段），
    // 刻意不複製 CSR 那組「沒有 desc 時才用」的樣板文字——那段在 304 頁會一模一樣，
    // 對搜尋引擎是重複內容，留給 CSR 當保險就好。
    swap(
        '<span id="product-brand" class="text-base font-black tracking-widest text-[#f2a7b5] uppercase mb-3 block">品牌名稱</span>',
        `<span id="product-brand" class="text-base font-black tracking-widest text-[#f2a7b5] uppercase mb-3 block">${escapeHtml(item.brand)}</span>`
    );
    swap(
        '<h1 id="product-name" class="text-3xl md:text-4xl font-black text-[#2d2d2d] leading-tight mb-2">商品名稱</h1>',
        `<h1 id="product-name" class="text-3xl md:text-4xl font-black text-[#2d2d2d] leading-tight mb-2">${escapeHtml(item.name)}</h1>`
    );
    if (item.image || item.img) {
        swap(
            'id="product-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7" alt="載入中..."',
            `id="product-image" src="${escapeHtml(item.image || item.img)}" alt="${escapeHtml(fullName)}"`
        );
    }
    if ((item.desc || '').trim()) {
        swap(
            '<p id="product-description" class="text-base text-gray-700 leading-relaxed font-bold">載入中...</p>',
            `<p id="product-description" class="text-base text-gray-700 leading-relaxed font-bold">${escapeHtml(item.desc)}</p>`
        );
    }

    return html;
}

module.exports = async (req, res) => {
    try {
        const template = readTemplate();
        const raw = req.query && req.query.item;
        const itemName = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
        const hit = findItem(readJson('site-data.json'), itemName);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        if (!hit) {
            // 查無此商品：回 404，讓 Google 正確判斷這不是一個真實頁面（避免軟 404
            // 變成「已檢索但未建立索引」的雜訊）。頁面內容仍照舊由 CSR 補上
            // 「找不到此商品」那一整組畫面，使用者看到的東西不變。
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
            res.status(404).send(template);
            return;
        }

        let scoreEntry = null;
        try {
            const scores = readJson('scores-data.json');
            scoreEntry = scores[`${hit.item.brand}||${hit.item.name}`] || null;
        } catch (err) {
            // 評分檔讀不到只影響 Product schema 的星等，其餘 meta 照常輸出
            scoreEntry = null;
        }

        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
        res.status(200).send(renderItemHtml(template, hit.item, hit.subcategoryName, scoreEntry));
    } catch (err) {
        try {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(readTemplate());
        } catch (fallbackErr) {
            res.status(500).send('Internal Server Error');
        }
    }
};
