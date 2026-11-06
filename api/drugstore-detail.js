// Vercel Serverless Function：伺服器端渲染 drugstore-detail.html（開架美妝商品頁）
//
// 跟 api/item-detail.js 同一套做法：範本檔名刻意不叫 drugstore-detail.html，否則 Vercel 的
// rewrites（在檔案系統比對之後才執行）會被同名靜態檔搶先，rewrite 永遠不會觸發。
// 網址是 /drugstore-detail.html?p=<slug>，slug 存在 drugstore-products.json 每個商品的 slug 欄位。
//
// 資料源是 drugstore-products.json（開架目錄，沒有評分）。頁面全部在伺服端寫好，不依賴前端 JS 補內容；
// script.js 只負責導覽列。
//
// 索引規則（避免 59 頁薄內容）：只有 `detail`（價格／規格／特色／使用方式）有資料的商品才可被索引，
// 只有一句重點的商品頁輸出 noindex,follow，也不進 sitemap。補完 detail 後會自動轉為可索引。
//
// 任何一步出錯都回 500 以外的安全頁：找不到商品回 404；其他例外回首頁式的簡單錯誤頁。

const fs = require('fs');
const path = require('path');

const SITE = 'https://www.theglowmakeup.org';

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

const cache = new Map();
function readFile(file) {
    if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(process.cwd(), file), 'utf-8'));
    return cache.get(file);
}

function hasDetail(p) {
    const d = p && p.detail;
    return !!(d && ((d.features && d.features.length) || d.price || d.spec || d.how_to));
}

function absoluteImage(raw) {
    if (!raw) return `${SITE}/assets/hero-bg.jpg`;
    try { return new URL(raw, SITE + '/').href; } catch (e) { return `${SITE}/assets/hero-bg.jpg`; }
}

function infoRow(label, value) {
    if (!value) return '';
    return `<div class="flex gap-3 py-3 border-b border-[#f2a7b5]/15 last:border-0">
                <dt class="w-20 shrink-0 font-black text-[#e0708a]">${escapeHtml(label)}</dt>
                <dd class="text-gray-700 leading-relaxed">${escapeHtml(value)}</dd>
            </div>`;
}

function buildMain(p) {
    const d = p.detail || {};
    const secUrl = `drugstore-beauty.html?section=${encodeURIComponent(p.section)}`;
    const img = p.image
        ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.brand + ' ' + p.name)}" class="w-full h-full object-contain p-6 md:p-10">`
        : `<div class="w-full h-full flex items-center justify-center text-4xl font-black text-[#f2a7b5]">${escapeHtml(p.brand)}</div>`;

    const features = (d.features || []).length
        ? `<section class="mt-10">
            <h2 class="text-2xl font-black mb-4">商品特色與重點</h2>
            <ul class="list-disc pl-5 space-y-2 text-gray-700 leading-relaxed">
                ${d.features.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}
            </ul>
        </section>`
        : '';
    const info = [infoRow('價格', d.price), infoRow('規格', d.spec), infoRow('使用方式', d.how_to)].join('');
    const infoBlock = info
        ? `<section class="mt-10">
            <h2 class="text-2xl font-black mb-4">商品資訊</h2>
            <dl class="bg-white rounded-2xl border border-[#f2a7b5]/20 px-5 shadow-sm">${info}</dl>
        </section>`
        : '';
    const notes = [];
    if (d.note) notes.push(escapeHtml(d.note));
    const dateStr = d.verified_date || p.verified_date;
    if (dateStr) notes.push(`資料核對日 ${escapeHtml(dateStr)}，價格與規格以通路頁為準。`);
    const noteBlock = notes.length ? `<p class="mt-6 text-xs text-gray-400 leading-relaxed">${notes.join('<br>')}</p>` : '';

    const source = p.source_url
        ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="nofollow noopener noreferrer" class="inline-block mt-6 px-8 py-3 bg-[#f2a7b5] text-white font-black rounded-full hover:bg-[#d88a99] transition-colors shadow-sm">前往${escapeHtml(p.source_label || '來源頁')}看更多</a>`
        : '';

    return `        <nav aria-label="breadcrumb" class="text-xs text-gray-400 font-bold mb-8">
            <a href="index.html" class="hover:text-[#f2a7b5]">首頁</a> /
            <a href="drugstore-beauty.html" class="hover:text-[#f2a7b5]">開架美妝</a> /
            <a href="${escapeHtml(secUrl)}" class="hover:text-[#f2a7b5]">${escapeHtml(p.section)}</a>
        </nav>
        <div class="grid md:grid-cols-2 gap-8 md:gap-12 items-start">
            <div class="bg-white rounded-3xl border border-[#f2a7b5]/15 shadow-sm aspect-square overflow-hidden">${img}</div>
            <div>
                <span class="text-base font-black tracking-widest text-[#f2a7b5] uppercase mb-3 block">${escapeHtml(p.brand)}</span>
                <h1 class="text-3xl md:text-4xl font-black text-[#2d2d2d] leading-tight mb-4">${escapeHtml(p.name)}</h1>
                <span class="inline-block px-4 py-1 bg-[#fff3f6] text-[#e0708a] rounded-full text-xs font-black">${escapeHtml(p.section)}</span>
                <div class="mt-6 bg-white rounded-2xl border border-[#f2a7b5]/20 p-5 shadow-sm">
                    <div class="text-xs font-black tracking-widest text-gray-400 mb-2">✦ 產品特點 / PRODUCT FEATURES</div>
                    <p class="text-base text-gray-700 leading-relaxed font-bold">${escapeHtml(p.highlight || '')}</p>
                </div>
                ${source}
            </div>
        </div>
        ${infoBlock}${features}${noteBlock}`;
}

function renderPage(slug) {
    const data = JSON.parse(readFile('drugstore-products.json'));
    const p = (data.products || []).find((x) => x.slug === slug);
    if (!p) return null;
    const fullName = `${p.brand} ${p.name}`;
    const indexable = hasDetail(p);
    const title = `${fullName} | 開架美妝 | Glow Makeup`;
    const first = (p.detail && p.detail.features && p.detail.features[0]) || '';
    const descRaw = `${fullName}：${p.highlight || ''}${first ? '；' + first : ''}`.replace(/\s+/g, ' ');
    const desc = descRaw.length > 150 ? descRaw.slice(0, 147) + '…' : descRaw;
    const canonical = `${SITE}/drugstore-detail.html?p=${encodeURIComponent(p.slug)}`;
    const breadcrumb = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            ['首頁', `${SITE}/`],
            ['開架美妝', `${SITE}/drugstore-beauty.html`],
            [p.section, `${SITE}/drugstore-beauty.html?section=${encodeURIComponent(p.section)}`],
            [p.name, canonical],
        ].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })),
    });
    let html = readFile('drugstore-detail.template.html');
    const rep = {
        '{{TITLE}}': escapeHtml(title),
        '{{DESC}}': escapeHtml(desc),
        '{{ROBOTS}}': indexable ? 'index,follow' : 'noindex,follow',
        '{{CANONICAL}}': escapeHtml(canonical),
        '{{OGIMAGE}}': escapeHtml(absoluteImage(p.image)),
        '{{JSONLD}}': `<script type="application/ld+json" id="breadcrumb-jsonld">${breadcrumb}</script>`,
        '{{MAIN}}': buildMain(p),
    };
    for (const [k, v] of Object.entries(rep)) {
        if (!html.includes(k)) throw new Error(`drugstore-detail 範本找不到 ${k}`);
        html = html.split(k).join(v);
    }
    return html;
}

module.exports = async (req, res) => {
    try {
        const raw = req.query && req.query.p;
        const slug = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
        const html = renderPage(slug);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (!html) {
            res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
            res.status(404).send('<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>找不到商品 | Glow Makeup</title><p style="font-family:sans-serif;padding:2rem">找不到這個商品。<a href="/drugstore-beauty.html">回開架美妝</a></p>');
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
        res.status(200).send(html);
    } catch (err) {
        res.status(500).send('Internal Server Error');
    }
};

module.exports.renderPage = renderPage;
module.exports.hasDetail = hasDetail;
