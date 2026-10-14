// Vercel Serverless Function：伺服器端渲染 detail.html（看板／評比的子分類頁）
//
// 跟 api/article.js、api/item-detail.js 同一套做法，資料源是 site-data.json。
//
// 為什麼需要這個：這個模板服務 43 個子分類網址（見 sitemap.xml），但不執行 JavaScript
// 時送出去的是同一份 HTML：
//   1. <title> 固定「Glow Makeup | 分類詳情」、description 固定一句、H1 是「載入中...」
//   2. **canonical 指向 board-landing.html，不是指向自己**——等於這 43 頁全部對外宣告
//      自己是那一頁的複本。頁面裡的 canonical-early 腳本會在解析當下改正，但那仍然要
//      執行 JavaScript；不執行的那一輪讀到的就是錯的。這是三個問題裡最嚴重的一個。
//   3. og:url 指向首頁，社群分享時每一頁都被歸到首頁同一個 URL 物件
//
// 首頁渲染後有 112 個連結指向這個模板，所以這批頁面不是邊緣路徑。
//
// ⚠️ 範本檔名刻意不叫 detail.html：Vercel 的 rewrites 在「檔案系統比對之後」才執行，
// 只要根目錄留著同名靜態檔，請求就會被它接走、rewrite 永遠不觸發（article.html 踩過
// 這個坑，詳見 api/article.js 的註解）。網址完全不變。
//
// 任何一步出錯都 fallback 回傳原始範本，行為等同加這支 function 之前的現況。

const fs = require('fs');
const path = require('path');

const SITE = 'https://www.theglowmakeup.org';

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function readTemplate() {
    return fs.readFileSync(path.join(process.cwd(), 'detail.template.html'), 'utf-8');
}

// site-data.json 約 350KB，同一個執行實例裡不會變（build 時打包進來），直接快取
let siteDataCache = null;
function readSiteData() {
    if (!siteDataCache) {
        siteDataCache = JSON.parse(
            fs.readFileSync(path.join(process.cwd(), 'site-data.json'), 'utf-8')
        );
    }
    return siteDataCache;
}

function firstImage(details) {
    const item = ((details && details.items) || []).find((it) => it.image || it.img);
    if (!item) return '';
    const raw = item.image || item.img;
    return raw.startsWith('http') ? raw : `${SITE}/${raw}`;
}

function renderDetailHtml(template, sub, fromContext, details) {
    // 跟 detail.template.html 裡 DOMContentLoaded 的寫法保持一致，兩邊要一起改
    const modeLabel = fromContext === 'review' ? '精選評比' : '美妝看板';
    const title = `${sub}${modeLabel} | Glow Makeup`;
    const desc = `Glow Makeup ${modeLabel}：${sub}真實社群評分與網友心得彙整，購物不踩雷。`;
    // canonical 一律用 from=board，跟前端與 sitemap.xml 的寫法一致（review 模式不另開網址）
    const canonical = `${SITE}/detail.html?sub=${encodeURIComponent(sub)}&from=board`;
    const image = firstImage(details);

    const breadcrumb = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            ['首頁', `${SITE}/`],
            ['熱門美妝看板', `${SITE}/board-landing.html`],
            [sub, canonical],
        ].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })),
    });

    let html = template;
    const swap = (needle, replacement) => {
        if (!html.includes(needle)) {
            // 範本被改過、對不上了：丟出去讓 catch 回退原始範本，不要送出只改到一半的 HTML
            throw new Error(`detail 範本找不到待取代片段: ${needle.slice(0, 60)}`);
        }
        html = html.replace(needle, replacement);
    };

    swap('<title>Glow Makeup | 分類詳情</title>', `<title>${escapeHtml(title)}</title>`);
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
        'id="og-title" content="Glow Makeup | 分類詳情">',
        `id="og-title" content="${escapeHtml(title)}">`
    );
    swap(
        'id="og-description" content="Glow Makeup 真實社群美妝評分與心得彙整。">',
        `id="og-description" content="${escapeHtml(desc)}">`
    );
    swap(
        '<script type="application/ld+json" id="breadcrumb-jsonld"></script>',
        `<script type="application/ld+json" id="breadcrumb-jsonld">${breadcrumb}</script>`
    );
    // og:image 範本預設是 hero-bg.jpg，查得到該分類的商品圖才換掉
    if (image) {
        swap(
            'id="og-image" content="https://www.theglowmakeup.org/assets/hero-bg.jpg">',
            `id="og-image" content="${escapeHtml(image)}">`
        );
    }
    // 可見內容：H1。商品清單與評比表仍由前端渲染（資料量大、且有排序/篩選互動），
    // 這支 function 只負責把「這一頁是什麼」寫進伺服器回傳的 HTML。
    swap(
        '<h1 id="page-title" class="text-4xl font-black italic relative z-10">載入中...</h1>',
        `<h1 id="page-title" class="text-4xl font-black italic relative z-10">${escapeHtml(modeLabel + '：' + sub)}</h1>`
    );

    return html;
}

module.exports = async (req, res) => {
    try {
        const template = readTemplate();
        const q = req.query || {};
        const raw = q.sub;
        const sub = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '').trim();
        const fromRaw = q.from;
        const fromContext = (typeof fromRaw === 'string' ? fromRaw : 'board') || 'board';

        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        const details = sub ? (readSiteData().subcategoryDetails || {})[sub] : null;
        if (!sub || !details) {
            // 沒帶 sub 或查無這個子分類：回 404，避免軟 404 被當成「已檢索但未建立索引」。
            // 畫面仍由前端補上「未指定分類」，使用者看到的東西不變。
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
            res.status(404).send(template);
            return;
        }

        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
        res.status(200).send(renderDetailHtml(template, sub, fromContext, details));
    } catch (err) {
        try {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(readTemplate());
        } catch (fallbackErr) {
            res.status(500).send('Internal Server Error');
        }
    }
};
