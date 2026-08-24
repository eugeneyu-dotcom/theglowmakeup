// Vercel Serverless Function：伺服器端渲染 article.html
//
// 為什麼需要這個：全站原本是純前端渲染（CSR），article.html 的原始 HTML 骨架裡
// 文章內容區塊是空的（只有「載入中...」），標題/meta description/og:image 都要等
// JS 抓完 articles.json 才會補上去。這導致：
//   1. Google 爬蟲雖然會執行 JS，但要排隊到「渲染」這一關才看得到真正內容，拖慢索引速度
//   2. LINE/Threads/Facebook 等社群分享預覽卡片產生器不會執行 JS，抓到的永遠是同一個
//      通用標題「Glow Makeup | 保養專欄」跟空白圖，拖累社群分享點擊率
//
// 這支 function 攔截對 /article.html 的請求（見 vercel.json 的 rewrite），讀本機
// article.html 當範本、articles.json 當資料源，把真正的標題/meta/schema/文章內文
// 直接寫進伺服器回傳的 HTML 裡——網址完全不變，站內外所有連結、GSC 已收錄的網址都不用動。
// 瀏覽器載入後 script.js 原本的 CSR 邏輯還是會照跑一次（重新渲染同一份內容），
// 純粹是多一次冪等的 DOM 更新，不影響互動功能，也是這支 function 出錯時的安全網。
//
// 任何一步出錯都 fallback 回傳「未經改寫的原始靜態範本」，行為等同修這支 function 之前的
// 現況（讓 CSR 補內容），而不是讓文章頁掛掉、比現況更差。

const fs = require('fs');
const path = require('path');

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function readTemplate() {
    return fs.readFileSync(path.join(process.cwd(), 'article.html'), 'utf-8');
}

function readArticles() {
    const raw = fs.readFileSync(path.join(process.cwd(), 'articles.json'), 'utf-8');
    return JSON.parse(raw).articles || [];
}

function renderArticleHtml(template, article) {
    const title = `${article.title} | Glow Makeup`;
    const desc = article.excerpt || '';
    const image = article.image ? `https://www.theglowmakeup.org/${article.image}` : '';
    const canonical = `https://www.theglowmakeup.org/article.html?id=${encodeURIComponent(article.id)}`;
    const dateDisplay = (article.date || '').replace(/-/g, '.');

    const schema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        description: desc,
        image: image || undefined,
        datePublished: article.date || undefined,
        author: { '@type': 'Organization', name: 'Glow Makeup' },
        publisher: { '@type': 'Organization', name: 'Glow Makeup' },
        mainEntityOfPage: canonical,
    });

    // 跟 script.js 裡 CSR 產生的 article-root innerHTML 保持完全同一份樣板，
    // 避免 SSR 版跟之後 client-side 重新渲染的畫面對不上而閃爍/跳動
    const articleBodyHtml = `
                <article class="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#f2a7b5]/10">
                    <span class="bg-[#f2a7b5] text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest">${article.tag ? '#' + escapeHtml(article.tag) : '保養專欄'}</span>
                    <h1 class="text-2xl md:text-4xl font-black text-[#2d2d2d] leading-tight mt-4 mb-2">${escapeHtml(article.title)}</h1>
                    <p class="text-sm text-gray-400 font-bold mb-8">${dateDisplay}</p>
                    <img src="${article.image}" alt="${escapeHtml(article.title)}" class="w-full rounded-3xl mb-8 object-cover max-h-[420px]">
                    <div class="article-body">${article.content}</div>
                </article>`;

    return template
        .replace(
            '<title>Glow Makeup | 保養專欄</title>',
            `<title>${escapeHtml(title)}</title>`
        )
        .replace(
            'id="meta-description" content="Glow Makeup 保養專欄：美妝知識與實用技巧分享。">',
            `id="meta-description" content="${escapeHtml(desc)}">`
        )
        .replace(
            'id="og-title" content="Glow Makeup | 保養專欄">',
            `id="og-title" content="${escapeHtml(title)}">`
        )
        .replace(
            'id="og-description" content="Glow Makeup 保養專欄：美妝知識與實用技巧分享。">',
            `id="og-description" content="${escapeHtml(desc)}">`
        )
        .replace(
            'id="og-image" content="">',
            `id="og-image" content="${escapeHtml(image)}">`
        )
        .replace(
            'id="canonical-link" href="https://www.theglowmakeup.org/skincare-blog.html">',
            `id="canonical-link" href="${canonical}">`
        )
        .replace(
            '<script type="application/ld+json" id="schema-jsonld"></script>',
            `<script type="application/ld+json" id="schema-jsonld">${schema}</script>`
        )
        .replace(
            '<div class="text-gray-400 text-sm">載入中...</div>',
            articleBodyHtml
        );
}

module.exports = async (req, res) => {
    try {
        const template = readTemplate();
        const id = typeof req.query.id === 'string' ? req.query.id : '';
        const articles = readArticles();
        const article = articles.find((a) => a.id === id);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        if (!article) {
            // 沒有對應文章：回 404（讓 Google 正確判斷這不是一個真實頁面，避免軟 404
            // 被當成「已檢索但未建立索引」的雜訊），內容仍照舊由 client JS 補上「找不到這篇文章」
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
            res.status(404).send(template);
            return;
        }

        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
        res.status(200).send(renderArticleHtml(template, article));
    } catch (err) {
        // 任何非預期錯誤都退回原始範本，讓頁面至少能跑（跟修這支 function 之前的行為一致），
        // 不要讓 500 錯誤頁面比「CSR 補內容」更差
        try {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.status(200).send(readTemplate());
        } catch (fallbackErr) {
            res.status(500).send('Internal Server Error');
        }
    }
};
