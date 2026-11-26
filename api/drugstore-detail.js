// Vercel Serverless Function：伺服器端渲染 drugstore-detail.html（開架美妝商品頁）
//
// 跟 api/item-detail.js 同一套做法：範本檔名刻意不叫 drugstore-detail.html，否則 Vercel 的
// rewrites（在檔案系統比對之後才執行）會被同名靜態檔搶先，rewrite 永遠不會觸發。
// 網址是 /drugstore-detail.html?p=<slug>，slug 存在 drugstore-products.json 每個商品的 slug 欄位。
//
// 資料源是 drugstore-products.json（開架目錄，沒有評分）。頁面全部在伺服端寫好，不依賴前端 JS 補內容；
// script.js 只負責導覽列。
//
// 索引規則（避免 59 頁薄內容）：只有 `detail` 有「特色或價格」的商品才可被索引（只有規格／色數不算），
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
    // 只有 spec（色數／容量）而沒有特色或價格的頁面仍太薄，維持 noindex
    return !!(d && ((d.features && d.features.length) || d.price));
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

// ===== 評分與網友心得（2026-11-26）=====
// 資料來自 drugstore-scores.json（build_scores_data.py 依 Items.csv 的 Channel 欄分流輸出，
// 專櫃的 scores-data.json 完全不含開架品項）。商品頁 slug → 「品牌||品項」靠 drugstore-score-map.json 對應。
// 沒有分數（有效評論不足 5 則）的商品不顯示這兩個區塊，也不寫樣板文字。
function readOptionalJson(file) {
    try { return JSON.parse(readFile(file)); } catch (e) { return null; }
}

function findScoreEntry(slug) {
    const scores = readOptionalJson('drugstore-scores.json');
    if (!scores) return null;
    const map = readOptionalJson('drugstore-score-map.json');
    const m = map && map.map && map.map[slug];
    if (m) {
        const hit = scores[`${m.brand}||${m.name}`];
        if (hit) return hit;
    }
    return Object.values(scores).find((v) => v && v.slug === slug) || null;
}

// 依 CLAUDE.md 評分分級（台灣使用者直覺版）
function gradeOf(score) {
    if (score >= 4.5) return { label: '優秀', color: '#d4af37' };
    if (score >= 4.0) return { label: '不錯，可以用', color: '#f2a7b5' };
    if (score >= 3.5) return { label: '普通，特定人群可用', color: '#6b7280' };
    if (score >= 3.0) return { label: '負面評價居多', color: '#e29547' };
    return { label: '幾乎只有負面', color: '#e05a47' };
}

function platformBadge(platform) {
    const cls = platform === '小紅書' ? 'bg-[#fde2e4] text-[#e05a47]'
        : platform === 'Threads' ? 'bg-[#2d2d2d] text-white'
        : 'bg-blue-50 text-blue-500';
    return `<span class="text-[10px] font-black px-2 py-0.5 rounded-full ${cls}">${escapeHtml(platform)}</span>`;
}

function buildScoreSections(entry) {
    if (!entry || entry.composite == null) return '';
    const g = gradeOf(entry.composite);
    const inds = Object.entries(entry.indicators || {}).filter(([, v]) => v != null);
    const indRows = inds.map(([name, v]) => {
        const c = gradeOf(v).color;
        return `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-[#f2a7b5]/5 last:border-b-0">
                                <span class="text-base font-bold text-[#2d2d2d]">${escapeHtml(name)}</span>
                                <div class="flex items-center gap-1"><span class="text-lg font-black" style="color:${c}">${Number(v).toFixed(1)}</span><span class="text-xs font-bold text-gray-400">/ 5.0</span></div>
                            </div>`;
    }).join('');
    const summary = entry.reviewSummary
        ? `<div class="mb-6 p-6 bg-[#fdf6e6] rounded-3xl border border-[#d4af37]/20">
                                <h3 class="text-xs font-black text-[#b8912e] uppercase tracking-wider mb-2">💬 網友評價匯總 / Community Verdict</h3>
                                <p class="text-base text-gray-700 leading-relaxed font-bold">${escapeHtml(entry.reviewSummary)}</p>
                            </div>`
        : '';
    const scoreCard = `<div class="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#f2a7b5]/10">
                    <div class="flex items-center gap-3 mb-6 border-b border-gray-100 pb-5">
                        <span class="text-3xl">⭐</span>
                        <div>
                            <h2 class="text-2xl md:text-3xl font-black text-[#2d2d2d] italic">網友綜合評鑑分數 <span class="text-[#f2a7b5] not-italic text-lg">Netizen Rating</span></h2>
                            <p class="text-sm text-gray-500 font-bold">彙整 Threads、Google、小紅書的真實使用心得，已排除業配與不相關貼文</p>
                        </div>
                    </div>
                    ${summary}
                    <div class="flex items-end gap-4 mb-6">
                        <span class="text-6xl font-black leading-none" style="color:${g.color}">${Number(entry.composite).toFixed(1)}</span>
                        <div class="pb-1"><div class="text-xs font-bold text-gray-400">/ 5.0 綜合評分</div><div class="text-base font-black" style="color:${g.color}">${escapeHtml(g.label)}</div></div>
                    </div>
                    ${indRows ? `<div class="space-y-1">${indRows}</div>` : ''}
                    <p class="text-xs text-gray-400 leading-relaxed border-t border-gray-100 pt-4 mt-6">分數由社群心得統計而來，各指標的評論量不同；開架商品與專櫃商品的價位與族群不同，分數不宜直接跨類比較。</p>
                </div>`;
    const ts = (entry.testimonials || []).filter((t) => t && t.text);
    const tmCard = ts.length
        ? `<div class="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-[#f2a7b5]/10">
                    <div class="flex items-center gap-3 mb-8 border-b border-gray-100 pb-5">
                        <span class="text-3xl">💬</span>
                        <div>
                            <h2 class="text-2xl md:text-3xl font-black text-[#2d2d2d] italic">真實網友心得 <span class="text-[#f2a7b5] not-italic text-lg">User Testimonials</span></h2>
                            <p class="text-sm text-gray-500 font-bold">精選小紅書、Threads、Google 的真實評論，帳號已馬賽克保護隱私</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">${ts.map((t) => `
                        <div class="bg-[#fff9f5] rounded-2xl p-5 border border-[#f2a7b5]/10">
                            <div class="flex items-center gap-2 mb-2.5">
                                ${platformBadge(t.platform)}
                                <span class="text-xs font-bold text-gray-500">@${escapeHtml(t.author || '網友')}</span>
                                ${t.likes ? `<span class="text-[10px] text-gray-400 font-bold ml-auto whitespace-nowrap">👍 ${escapeHtml(Number(t.likes).toLocaleString('en-US'))}</span>` : ''}
                            </div>
                            <p class="tm-text text-sm text-gray-600 leading-relaxed" style="display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">「${escapeHtml(t.text)}」</p>
                            <button type="button" class="tm-toggle hidden mt-2 text-xs font-black text-[#f2a7b5] hover:underline">展開全文 ▾</button>
                        </div>`).join('')}
                    </div>
                </div>
                <script>
                (function(){
                  document.querySelectorAll('.tm-text').forEach(function(p){
                    var b=p.parentElement.querySelector('.tm-toggle'); if(!b) return;
                    function check(){ if(p.dataset.open==='1') return; if(p.scrollHeight-p.clientHeight>2) b.classList.remove('hidden'); }
                    b.addEventListener('click',function(){
                      if(p.dataset.open==='1'){p.dataset.open='0';p.style.display='-webkit-box';p.style.webkitLineClamp='4';b.textContent='展開全文 ▾';}
                      else{p.dataset.open='1';p.style.webkitLineClamp='';p.style.display='block';b.textContent='收合 ▴';}
                    });
                    check(); window.addEventListener('load',check); setTimeout(check,600);
                  });
                })();
                </script>`
        : '';
    return scoreCard + tmCard;
}

// 版型比照專櫃商品頁（item-detail.template.html）：返回連結、大卡片（左圖右文）、
// 「特色介紹」漸層邊框卡、同類熱門單品。專櫃頁有、但開架沒有資料的區塊（適用人群、評分、成分、網友心得）
// 一律不顯示，不寫樣板文字湊版面。
function buildMain(p, all, scoreEntry) {
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
        ? `匯整本商品的特色亮點與商品資訊（整理自${escapeHtml(p.source_label || '來源頁')}）`
        : '';
    const panel = `<div class="border-t border-gray-100 pt-8">
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
                            ${panel}
                        </div>
                    </div>
                </div>
                ${buildScoreSections(scoreEntry)}
                ${relatedHtml}
        </div>`;
}

function renderPage(slug) {
    const data = JSON.parse(readFile('drugstore-products.json'));
    const p = (data.products || []).find((x) => x.slug === slug);
    if (!p) return null;
    const fullName = `${p.brand} ${p.name}`;
    const indexable = hasDetail(p);
    const title = `${fullName} | Glow Makeup`;
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
        '{{MAIN}}': buildMain(p, data.products || [], findScoreEntry(p.slug)),
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
