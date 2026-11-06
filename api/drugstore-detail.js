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
    return `<div class="flex gap-3 py-3 border-b border-gray-100 last:border-0">
                        <dt class="w-20 shrink-0 font-black text-[#e0708a]">${escapeHtml(label)}</dt>
                        <dd class="text-sm text-[#666666] font-bold leading-relaxed">${escapeHtml(value)}</dd>
                    </div>`;
}

const GROUP_LABEL = { drug: '藥妝開架', olive: 'Olive Young' };

// 版型比照專櫃商品頁（item-detail.template.html）：返回連結、大卡片（左圖右文）、
// 「特色介紹」漸層邊框卡、同類熱門單品。專櫃頁有、但開架沒有資料的區塊（適用人群、評分、成分、網友心得）
// 一律不顯示，不寫樣板文字湊版面。
function buildMain(p, all) {
    const d = p.detail || {};
    const secUrl = `drugstore-beauty.html?section=${encodeURIComponent(p.section)}`;
    const img = p.image
        ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.brand + ' ' + p.name)}" class="max-w-full max-h-[450px] object-contain rounded-2xl group-hover:scale-105 transition-transform duration-500">`
        : `<div class="text-4xl font-black text-[#f2a7b5]">${escapeHtml(p.brand)}</div>`;

    const tags = [p.section, GROUP_LABEL[p.group] || '', p.source_label || ''].filter(Boolean);
    const tagHtml = tags.map((t) => `<span class="px-3 py-1 bg-[#f2a7b5]/10 text-[#e0708a] text-xs font-black rounded-full">#${escapeHtml(t)}</span>`).join('');

    // 連結優先序（使用者 2026-11-06 指定）：品牌自家網站（official_url）> 其他通路頁（source_url）。
    // official_url 要先開頁面核對過才可填，查不到就留空、退回通路頁，不猜網址。
    const linkUrl = p.official_url || p.source_url;
    const linkLabel = p.official_url ? '品牌官網' : (p.source_label || '來源頁');
    const source = linkUrl
        ? `<div class="mb-8">
                                <a href="${escapeHtml(linkUrl)}" target="_blank" rel="nofollow noopener noreferrer" class="inline-block px-9 py-4 bg-[#f2a7b5] text-white font-black rounded-full hover:bg-[#d88a99] transition-all hover:-translate-y-0.5 shadow-[0_6px_20px_rgba(242,167,181,0.3)] text-center text-base tracking-wider">前往${escapeHtml(linkLabel)}看更多</a>
                            </div>`
        : '';

    const feats = (d.features || []).length
        ? `<div>
                        <h3 class="font-black text-lg text-[#2d2d2d] mb-3 flex items-center gap-2"><span class="text-[#f2a7b5]">✨</span> 產品優勢亮點 / Core Advantages</h3>
                        <ul class="space-y-2">${d.features.map((f) => `
                            <li class="flex items-start gap-2 text-sm text-[#666666] font-bold"><span class="text-[#f2a7b5] text-base select-none">✦</span><span class="leading-relaxed">${escapeHtml(f)}</span></li>`).join('')}
                        </ul>
                    </div>`
        : '';
    const info = [infoRow('價格', d.price), infoRow('規格', d.spec), infoRow('使用方式', d.how_to)].join('');
    const infoBlock = info
        ? `<div${feats ? ' class="border-t border-gray-100 pt-5"' : ''}>
                        <h3 class="font-black text-lg text-[#2d2d2d] mb-3 flex items-center gap-2"><span class="text-[#f2a7b5]">📋</span> 商品資訊 / Product Info</h3>
                        <dl>${info}</dl>
                    </div>`
        : '';
    const notes = [];
    if (d.note) notes.push(escapeHtml(d.note));
    const dateStr = d.verified_date || p.verified_date;
    if (dateStr) notes.push(`資料核對日 ${escapeHtml(dateStr)}，價格與規格以通路頁為準。`);
    const noteHtml = notes.length ? `<p class="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4">${notes.join('<br>')}</p>` : '';

    // 還沒有詳細資料（features/價格/規格/使用方式）的商品：只放目錄裡真實有的基本資訊，
    // 缺的欄位直接留白（不寫「整理中」說明），也不寫樣板優勢或適用人群湊版面。補完 detail 後會自動換成完整版。
    const hasFull = !!(feats || infoBlock);
    const basic = [infoRow('品牌', p.brand), infoRow('分類', `${GROUP_LABEL[p.group] || ''} / ${p.section}`), infoRow('資料來源', p.source_label)].join('');
    const basicBlock = `<div>
                        <h3 class="font-black text-lg text-[#2d2d2d] mb-3 flex items-center gap-2"><span class="text-[#f2a7b5]">📋</span> 商品基本資訊 / Basic Info</h3>
                        <dl>${basic}</dl>
                    </div>`;
    // 資料沒補齊的欄位直接留白，不寫「整理中」之類的說明（使用者 2026-11-06 指定）
    const panelSub = hasFull
        ? `整理自${escapeHtml(p.source_label || '來源頁')}的商品說明，價格、規格與使用方式一次看。`
        : '';
    const panel = `<div class="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#f2a7b5]/10">
                    <h2 class="text-2xl font-black text-[#2d2d2d] mb-1.5">商品特色與資訊</h2>
                    ${panelSub ? `<p class="text-sm text-gray-500 mb-6">${panelSub}</p>` : '<div class="mb-6"></div>'}
                    <div class="relative p-0.5 rounded-[24px] bg-gradient-to-tr from-[#f2a7b5] via-[#d88a99] to-[#d4af37] shadow-md">
                        <div class="bg-white rounded-[22px] p-6 space-y-6">
                    ${hasFull ? feats + infoBlock : basicBlock}${noteHtml}
                        </div>
                    </div>
                </div>`;

    const related = all.filter((x) => x.slug !== p.slug && x.group === p.group && x.section === p.section).slice(0, 6);
    const relatedHtml = related.length
        ? `<section>
                    <h2 class="text-2xl font-black mb-6 italic">Related Items / <span class="text-[#f2a7b5] text-lg not-italic">同類熱門單品</span></h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${related.map((x) => `
                        <a href="drugstore-detail.html?p=${encodeURIComponent(x.slug)}" class="bg-white p-6 rounded-2xl border border-gray-100 hover:border-[#f2a7b5] hover:shadow-lg transition-all group block">
                            <div class="aspect-square bg-gray-50 rounded-xl mb-4 p-4 overflow-hidden flex items-center justify-center">${x.image ? `<img src="${escapeHtml(x.image)}" alt="${escapeHtml(x.brand + ' ' + x.name)}" loading="lazy" class="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500">` : ''}</div>
                            <h3 class="font-bold text-lg mb-1 group-hover:text-[#f2a7b5] transition-colors">${escapeHtml(x.name)}</h3>
                            <p class="text-sm text-gray-500">${escapeHtml(x.brand)}</p>
                        </a>`).join('')}
                    </div>
                </section>`
        : '';

    return `        <div class="mb-8">
            <a href="${escapeHtml(secUrl)}" class="inline-flex items-center gap-2 text-base font-bold text-gray-500 hover:text-[#f2a7b5] transition-colors group">
                <span class="group-hover:-translate-x-1 transition-transform">&#10094;</span> 返回${escapeHtml(p.section)}
            </a>
        </div>
        <div class="w-full flex flex-col gap-12">
                <div class="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#f2a7b5]/10 flex flex-col md:flex-row gap-12 items-stretch">
                    <div class="w-full md:w-1/2 flex items-center justify-center bg-[#fff9f5] rounded-3xl p-8 overflow-hidden group border border-[#f2a7b5]/5 min-h-[300px]">${img}</div>
                    <div class="w-full md:w-1/2 flex flex-col justify-between py-2">
                        <div>
                            <span class="text-base font-black tracking-widest text-[#f2a7b5] uppercase mb-3 block">${escapeHtml(p.brand)}</span>
                            <h1 class="text-3xl md:text-4xl font-black text-[#2d2d2d] leading-tight mb-2">${escapeHtml(p.name)}</h1>
                            <div class="flex flex-wrap gap-2 mb-6">${tagHtml}</div>
                            <div class="mb-8 p-6 bg-[#fff9f5] rounded-3xl border border-[#f2a7b5]/10">
                                <h2 class="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">✦ 產品特點 / Product Features</h2>
                                <p class="text-base text-gray-700 leading-relaxed font-bold">${escapeHtml(p.highlight || '')}</p>
                            </div>
                            ${source}
                        </div>
                    </div>
                </div>
                ${panel}
                ${relatedHtml}
        </div>`;
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
        '{{MAIN}}': buildMain(p, data.products || []),
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
