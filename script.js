/**
 * Glow Makeup Beauty Forum - Shared Logic v8
 */

// 0. 全站圖片 Fallback：破圖／被 CDN 擋熱連結（403）的圖片，自動換成乾淨的品牌佔位圖，
//    避免出現瀏覽器預設的破圖 icon。error 事件不冒泡，需用 capture 階段攔截。
const IMG_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
    '<rect width="240" height="240" rx="16" fill="#fdeef1"/>' +
    '<g fill="none" stroke="#f2a7b5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="120" cy="102" r="32"/><path d="M80 150h80"/><path d="M120 70V58"/></g>' +
    '<text x="120" y="205" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="bold" fill="#e6a0ad">Glow Makeup</text></svg>'
);
window.IMG_FALLBACK = IMG_FALLBACK; // 讓其他頁面的內嵌 script（detail.html/item-detail.html）也能直接引用同一張品牌佔位圖
document.addEventListener('error', function (e) {
    const el = e.target;
    if (el && el.tagName === 'IMG' && !el.dataset.imgFallback) {
        el.dataset.imgFallback = '1';
        el.src = IMG_FALLBACK;
    }
}, true);

// 1. Slider Logic —— 首頁大圖輪播＝保養專欄最新文章（資料來源 articles.json）
let currentSlide = 0;
let sliderInterval;

const SLIDE_TAG_COLORS = ['bg-[#d4af37]', 'bg-[#f2a7b5]', 'bg-[#2d2d2d]', 'bg-blue-400', 'bg-[#d88a99]'];
const MAX_SLIDES = 5;

let articlesCache = null;

// 取保養專欄文章，依日期由新到舊
// 快取的是「進行中的請求」而不只是結果：頁面上好幾個區塊同時呼叫時共用同一次下載，
// 不然每個都會各抓一份（articles.json 1.2MB、scores-data.json 0.7MB 都被重複下載過）。
let articlesPromise = null;
async function getArticles() {
    if (articlesCache) return articlesCache;
    if (!articlesPromise) {
        articlesPromise = (async () => {
            try {
                const res = await fetch('articles.json?v=165');
                const data = await res.json();
                articlesCache = (data.articles || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            } catch (err) {
                console.error('articles.json 載入失敗', err);
                articlesCache = [];
            }
            return articlesCache;
        })();
    }
    return articlesPromise;
}

function formatArticleDate(d) {
    return (d || '').replace(/-/g, '.');
}

async function initSlider() {
    const track = document.getElementById('mainSlider');
    if (!track) return;

    // 置頂文章（pinned:true）固定排在輪播最前面，其餘維持日期新到舊；
    // 只影響輪播本身，不動 getArticles() 共用排序，跑馬燈/最新文章卡片/文章列表頁都不受影響
    const allArticles = await getArticles();
    const pinnedArticles = allArticles.filter(a => a.pinned);
    const restArticles = allArticles.filter(a => !a.pinned);
    const articles = [...pinnedArticles, ...restArticles].slice(0, MAX_SLIDES);
    if (articles.length === 0) {
        track.innerHTML = '<div class="slide shrink-0 flex items-center justify-center bg-[#fdeef1]"><p class="font-black text-[#e6a0ad]">保養專欄尚無文章</p></div>';
        return;
    }

    track.innerHTML = articles.map((a, i) => `
        <a href="${a.url || 'skincare-blog.html'}" class="slide shrink-0 block" style="background-image: linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url('${a.image}')">
            <div class="absolute inset-0 flex items-center justify-center text-center px-4">
                <div class="max-w-4xl">
                    <span class="${SLIDE_TAG_COLORS[i % SLIDE_TAG_COLORS.length]} text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-widest mb-4 inline-block">${a.category === '活動' ? '活動快訊' : '保養專欄'}${a.tag ? ' · #' + a.tag : ''}</span>
                    <h2 class="text-3xl md:text-5xl font-black text-white drop-shadow-lg">${a.title}</h2>
                    <p class="text-white/80 text-sm font-bold mt-3 drop-shadow">${formatArticleDate(a.date)}</p>
                </div>
            </div>
        </a>
    `).join('');

    const dots = document.getElementById('sliderDots');
    if (dots) {
        dots.innerHTML = articles.map((_, i) => `
            <button class="w-2.5 h-2.5 rounded-full bg-white ${i === 0 ? 'opacity-100' : 'opacity-40 hover:opacity-80'} transition-opacity" onclick="goToSlide(${i})"></button>
        `).join('');
    }

    currentSlide = 0;
    if (articles.length > 1) {
        sliderInterval = setInterval(() => {
            goToSlide((currentSlide + 1) % articles.length);
        }, 4000);
    }
}

// 首頁跑馬燈「最新快訊」：真實文章標題輪播，取代原本沒有資料支撐的假促銷文案
const MARQUEE_EMOJIS = ['📢', '💄', '🌟', '✨'];
async function renderMarquee() {
    const el = document.getElementById('marquee-content');
    if (!el) return;
    const articles = (await getArticles()).slice(0, 4);
    if (articles.length === 0) {
        el.innerHTML = '<span class="mx-4 text-gray-300">保養專欄尚無文章</span>';
        return;
    }
    el.innerHTML = articles.map((a, i) => `
        <a href="${a.url || 'skincare-blog.html'}" class="hover:text-[#f2a7b5] mx-4 transition-colors">${MARQUEE_EMOJIS[i % MARQUEE_EMOJIS.length]} ${a.title}</a>
    `).join('');
}

// 首頁「美妝新品快報」：10 大專櫃品牌官網新品（資料來源見 new-products.json，人工逐一開官網查證整理，非自動抓取）
const BRAND_BADGE_COLORS = ['bg-[#2d2d2d]', 'bg-[#f2a7b5]', 'bg-[#d4af37]'];
// 沒有真實商品圖的品牌（官網圖片有防盜鏈擋下載）統一用同一套「品牌卡」漸層+品牌字樣呈現，
// 讓整排卡片視覺一致，不要一半真實照片、一半破圖感的預設佔位圖
const PLACEHOLDER_GRADIENTS = [
    'linear-gradient(135deg, #f2a7b5 0%, #d4af37 100%)',
    'linear-gradient(135deg, #2d2d2d 0%, #6b6b6b 100%)',
    'linear-gradient(135deg, #d4af37 0%, #f2a7b5 100%)'
];
function newProductImageBlock(p, i) {
    if (p.image) {
        return `
            <div class="aspect-square bg-white p-4 flex items-center justify-center overflow-hidden">
                <img src="${p.image}" alt="${p.brand} ${p.name}" class="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500">
            </div>`;
    }
    return `
        <div class="aspect-square flex items-center justify-center overflow-hidden" style="background:${PLACEHOLDER_GRADIENTS[i % PLACEHOLDER_GRADIENTS.length]}">
            <span class="text-white text-2xl font-black italic tracking-tight text-center px-4 drop-shadow-sm">${p.brand}</span>
        </div>`;
}
const NEW_PRODUCTS_MOBILE_VISIBLE = 6;

async function renderNewProducts() {
    const grid = document.getElementById('new-products-grid');
    if (!grid) return;
    try {
        const res = await fetch('new-products.json?v=10');
        const data = await res.json();
        const products = data.products || [];
        if (products.length === 0) {
            grid.innerHTML = '<div class="text-gray-400 text-sm">新品資訊整理中</div>';
            return;
        }
        grid.innerHTML = products.map((p, i) => `
            <a href="${p.source_url}" target="_blank" rel="noopener" class="bg-[#fff9f5] rounded-2xl md:rounded-3xl overflow-hidden border border-[#f2a7b5]/10 hover:shadow-md hover:border-[#f2a7b5]/30 transition-all group flex flex-col${i >= NEW_PRODUCTS_MOBILE_VISIBLE ? ' new-product-extra' : ''}">
                ${newProductImageBlock(p, i)}
                <div class="p-3 md:p-5 flex flex-col flex-grow">
                    <span class="${BRAND_BADGE_COLORS[i % BRAND_BADGE_COLORS.length]} text-white text-[9px] md:text-[10px] font-black px-2.5 md:px-3 py-1 rounded-full self-start mb-2 md:mb-3 tracking-wide">${p.brand}</span>
                    <h3 class="font-black text-xs md:text-sm leading-snug mb-1 md:mb-2 group-hover:text-[#f2a7b5] transition-colors line-clamp-2">${p.name}</h3>
                    <p class="hidden md:block text-xs text-gray-500 leading-relaxed line-clamp-3 flex-grow">${p.highlight || ''}</p>
                    <span class="text-[10px] md:text-[11px] font-bold text-[#f2a7b5] mt-2 md:mt-4 flex items-center gap-1">查看${p.source_label || '官網'} ➔</span>
                </div>
            </a>
        `).join('');
        const toggleBtn = document.getElementById('new-products-toggle-btn');
        if (toggleBtn) {
            if (products.length <= NEW_PRODUCTS_MOBILE_VISIBLE) {
                toggleBtn.parentElement.classList.add('hidden');
            } else {
                toggleBtn.textContent = `查看全部 ${products.length} 個新品 ➔`;
                toggleBtn.dataset.collapsedLabel = toggleBtn.textContent;
            }
        }
    } catch (err) {
        console.error('new-products.json 載入失敗', err);
        grid.innerHTML = '<div class="text-gray-400 text-sm">新品資訊載入失敗</div>';
    }
}

function toggleNewProductsExpand() {
    const grid = document.getElementById('new-products-grid');
    const btn = document.getElementById('new-products-toggle-btn');
    if (!grid || !btn) return;
    const collapsed = grid.classList.toggle('np-collapsed');
    btn.textContent = collapsed ? btn.dataset.collapsedLabel : '收起 ➔';
    if (collapsed) {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// 首頁「最新文章」卡片：真實 articles.json 最新 3 篇（取代原本連去錯誤頁面的樣板文章）
async function renderLatestArticlesSection() {
    const grid = document.getElementById('latest-articles-grid');
    if (!grid) return;
    const articles = (await getArticles()).slice(0, 8);
    if (articles.length === 0) {
        grid.innerHTML = '<div class="text-gray-400 text-sm">保養專欄尚無文章</div>';
        return;
    }
    grid.innerHTML = articles.map(a => `
        <div class="article-card group">
            <div class="aspect-[4/3] rounded-[24px] overflow-hidden mb-4 cursor-pointer" onclick="location.href='${a.url || 'skincare-blog.html'}'">
                <img src="${a.image}" onerror="this.src=window.IMG_FALLBACK" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700">
            </div>
            <div class="mb-3">
                <a href="${a.url || 'skincare-blog.html'}" class="inline-block px-3 py-1 bg-[#f2a7b5]/10 text-[#f2a7b5] text-[11px] font-black rounded-full uppercase tracking-widest hover:bg-[#f2a7b5] hover:text-white transition-colors">
                    ${a.tag ? '#' + a.tag : '保養專欄'}
                </a>
            </div>
            <h3 class="text-xl font-black mb-4 leading-tight group-hover:text-[#f2a7b5] transition-colors cursor-pointer" onclick="location.href='${a.url || 'skincare-blog.html'}'">${a.title}</h3>
        </div>
    `).join('');
}

// 最新文章橫向輪播：按一次箭頭滑動約一個卡片寬度（含間距），手機靠原生手勢滑動不需要箭頭
function scrollArticleCarousel(direction) {
    const track = document.getElementById('latest-articles-grid');
    if (!track) return;
    const card = track.querySelector('.article-card');
    const delta = card ? card.getBoundingClientRect().width + 32 : track.clientWidth * 0.8;
    track.scrollBy({ left: delta * direction, behavior: 'smooth' });
}

// 最新情報（news.html）：顯示「最新一個月」的文章；該月不足 5 篇時，用更早的最新文章補到 5 篇，避免月初版面太空。
// 版面＝一張主推大卡＋右側 4 張小卡；超過 5 篇的部分排在下方兩欄。刻意不放分類篩選與往期列表（使用者指定），跟保養專欄的列表區隔。
// 「最新一個月」以 articles.json 裡日期最新那篇所在的月份為準：月初還沒有新文章時，仍顯示上個月，不會空版。
async function renderWeeklyNews() {
    const root = document.getElementById('weekly-news');
    if (!root) return;

    const all = await getArticles();
    const dated = all.filter(a => /^\d{4}-\d{2}-\d{2}/.test(a.date || ''));
    if (dated.length === 0) {
        root.innerHTML = '<div class="text-gray-400 text-sm py-8">尚無文章</div>';
        return;
    }

    const MIN_SHOWN = 5;
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // getArticles() 已依日期由新到舊排序（同一天維持 articles.json 原順序）
    const monthKey = dated[0].date.slice(0, 7);
    const inMonth = dated.filter(a => a.date.startsWith(monthKey));
    const filler = dated.filter(a => !a.date.startsWith(monthKey)).slice(0, Math.max(0, MIN_SHOWN - inMonth.length));
    const shown = inMonth.concat(filler);

    const [lead, ...rest] = shown;
    const side = rest.slice(0, 4);
    const below = rest.slice(4);

    const small = (a, i, extra) => `
        <a href="${esc(a.url || '#')}" class="flex gap-4 bg-white rounded-2xl p-4 border border-[#f2a7b5]/15 shadow-sm hover:shadow-lg transition-shadow ${extra || ''}">
            <img src="${esc(a.image)}" alt="${esc(a.title)}" class="w-28 h-28 md:w-32 md:h-32 rounded-xl object-cover shrink-0">
            <div class="min-w-0">
                <span class="text-xs font-black text-[#f2a7b5]">No.${i + 2}</span>
                <span class="text-xs font-black text-gray-400"> · ${formatArticleDate(a.date)}${a.tag ? ' · #' + esc(a.tag) : ''}</span>
                <h3 class="text-base md:text-lg font-black leading-snug mt-1 line-clamp-3">${esc(a.title)}</h3>
            </div>
        </a>`;

    const leadCard = `
        <a href="${esc(lead.url || '#')}" class="${side.length ? 'md:col-span-3' : 'md:col-span-5'} block bg-white rounded-3xl overflow-hidden border border-[#f2a7b5]/15 shadow-sm hover:shadow-lg transition-shadow">
            <img src="${esc(lead.image)}" alt="${esc(lead.title)}" class="w-full aspect-[3/2] object-cover">
            <div class="p-6 md:p-8">
                <div class="flex items-center gap-2 mb-3">
                    <span class="bg-[#f2a7b5] text-white px-3 py-1 rounded-full text-xs font-black tracking-widest">最新上線</span>
                    <span class="text-xs font-black text-gray-400">${formatArticleDate(lead.date)}${lead.tag ? ' · #' + esc(lead.tag) : ''}</span>
                </div>
                <h2 class="text-2xl md:text-3xl font-black leading-snug mb-3">${esc(lead.title)}</h2>
                <p class="text-gray-500 line-clamp-3">${esc(lead.excerpt)}</p>
            </div>
        </a>`;

    root.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
            ${leadCard}
            ${side.length ? `<div class="md:col-span-2 flex flex-col gap-6">${side.map((a, i) => small(a, i)).join('')}</div>` : ''}
        </div>
        ${below.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">${below.map((a, i) => small(a, i + 4)).join('')}</div>` : ''}`;
}

// 最新情報下方的兩個區塊：本月新品（new-products.json，與首頁「美妝新品快報」同源）、網友怎麼說（scores-data.json 的真實心得）。
// 資料抓不到或空的時候整個區塊隱藏，不留空標題。
function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 最新情報「本月新品」卡片的展開區：點卡片（或「商品詳細資料」按鈕）就地展開／收合，不再直接跳到外站。
// 內容：完整重點句＋有填的 detail 欄位（price、spec、features[]、how_to）＋官網按鈕＋核對日。
// detail 欄位可選，沒有就只顯示重點句與官網連結，缺的欄位直接留白（不寫「整理中」）。
function newProductDetailBlock(p) {
    const d = p.detail || {};
    const row = (label, val) => val ? `<div class="mt-2"><span class="font-black text-[#2d2d2d]">${label}</span>　${escHtml(val)}</div>` : '';
    const feats = (d.features || []).length
        ? `<ul class="mt-2 list-disc pl-4 space-y-1">${d.features.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>` : '';
    return `<details class="mt-3 text-xs text-gray-600 leading-relaxed">
        <summary class="cursor-pointer font-black text-[#e0708a] select-none inline-block px-3 py-1.5 rounded-full bg-[#fff3f6]">商品詳細資料 ▾</summary>
        ${p.highlight ? `<p class="mt-3">${escHtml(p.highlight)}</p>` : ''}
        ${row('價格', d.price)}${row('規格', d.spec)}${feats}${row('使用方式', d.how_to)}
        <a href="${escHtml(p.source_url)}" target="_blank" rel="noopener" class="inline-block mt-3 font-black text-[#f2a7b5] hover:text-[#d88a99]">前往${escHtml(p.source_label || '官網')}看更多 ➔</a>
        ${p.verified_date ? `<p class="mt-2 text-[11px] text-gray-400">資料核對日 ${escHtml(p.verified_date)}，價格與規格以官網為準。</p>` : ''}
    </details>`;
}

async function renderNewsNewProducts() {
    const section = document.getElementById('news-new-products-section');
    const grid = document.getElementById('news-new-products');
    if (!section || !grid) return;
    try {
        const res = await fetch('new-products.json?v=10');
        const data = await res.json();
        const products = (data.products || []).slice(0, 6);
        if (products.length === 0) { section.remove(); return; }
        grid.innerHTML = products.map((p, i) => `
            <div data-np-card class="bg-white rounded-2xl overflow-hidden border border-[#f2a7b5]/15 shadow-sm hover:shadow-lg transition-all group flex flex-col self-start cursor-pointer">
                ${newProductImageBlock(p, i)}
                <div class="p-3 md:p-5 flex flex-col flex-grow">
                    <span class="${BRAND_BADGE_COLORS[i % BRAND_BADGE_COLORS.length]} text-white text-[10px] font-black px-3 py-1 rounded-full self-start mb-2 tracking-wide">${escHtml(p.brand)}</span>
                    <h3 class="font-black text-sm md:text-base leading-snug mb-1 group-hover:text-[#f2a7b5] transition-colors line-clamp-2">${escHtml(p.name)}</h3>
                    <p class="hidden md:block text-xs text-gray-500 leading-relaxed line-clamp-2">${escHtml(p.highlight || '')}</p>
                    ${newProductDetailBlock(p)}
                </div>
            </div>`).join('');
        // 點卡片任何位置都能展開／收合；點 summary 與卡片內連結由瀏覽器自己處理，避免連點兩次抵銷
        grid.querySelectorAll('[data-np-card]').forEach(card => card.addEventListener('click', e => {
            if (e.target.closest('summary') || e.target.closest('a')) return;
            const det = card.querySelector('details');
            if (det) det.open = !det.open;
        }));
    } catch (err) {
        console.error('new-products.json 載入失敗', err);
        section.remove();
    }
}

// 網友怎麼說的卡片 HTML（候選池版與後備版共用）
function renderVoiceCards(grid, picks, siteData) {
    grid.innerHTML = picks.map(({ e, t }) => {
        const img = findItemImage(siteData, e.subcat, e.brand, e.name);
        const text = t.text.replace(/\s+/g, ' ').trim();
        return `
            <a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=review" class="bg-white rounded-2xl p-5 border border-[#f2a7b5]/15 shadow-sm hover:shadow-lg transition-all flex flex-col gap-4">
                <p class="text-gray-700 leading-relaxed text-sm flex-grow">「${escHtml(text.length > 110 ? text.slice(0, 110) + '…' : text)}」</p>
                <div class="flex items-center gap-3 border-t border-[#f2a7b5]/15 pt-4">
                    ${img ? `<img ${thumbAttrs(img)} alt="${escHtml(e.brand)}" loading="lazy" decoding="async" class="w-12 h-12 object-contain rounded-lg bg-[#fff9f5] p-1 shrink-0">` : ''}
                    <div class="min-w-0">
                        <span class="text-[10px] font-black tracking-widest text-gray-400 uppercase">${escHtml(e.brand)}</span>
                        <div class="font-black text-sm leading-snug line-clamp-1">${escHtml(e.name)}</div>
                        <span class="text-xs font-bold text-[#f2a7b5]">★ ${e.composite.toFixed(1)} · ${escHtml(t.platform || '網友')}真實心得</span>
                    </div>
                </div>
            </a>`;
    }).join('');
}

// 網友怎麼說：候選池 voices-pool.json 由 build_voices_pool.py 在建置階段產出（已過品項門檻、語氣、商品比對篩選），
// 前端只負責依「台北時間的日期」決定今天顯示哪 6 則。
// 刻意不用隨機：同一天所有訪客與搜尋引擎看到的內容都一樣、隔天自動換一批；
// 也不產生任何網址參數或新頁面，每張卡片仍連到原本的商品頁。
// dayNumber 只給預覽／測試用（呼叫 renderNewsVoices(天數) 看不同日子的組合），正式頁面不傳。
function seededRng(seed) {   // mulberry32：同一個 seed 永遠產生同一串數字
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function taipeiDayNumber(d) { return Math.floor((d.getTime() + 8 * 3600 * 1000) / 86400000); }

async function renderNewsVoices(dayNumber) {
    const section = document.getElementById('news-voices-section');
    const grid = document.getElementById('news-voices');
    if (!section || !grid) return;
    try {
        const [scores, siteData, pool] = await Promise.all([
            getScoresData(), getSiteData(),
            fetch('voices-pool.json?v=1').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);
        // 池抓不到或空的 → 退回只看 scores-data.json 的舊做法，頁面不會變空
        if (!Array.isArray(pool) || pool.length === 0) return renderNewsVoicesFromScores();
        const cands = [];
        pool.forEach(t => {
            const e = (scores || {})[`${t.brand}||${t.name}`];
            // 品項分數與評論量以 scores-data.json 為準（池是建置當下的快照，分數後來掉下去就不該再顯示）
            if (!e || e.composite == null || e.composite < 3.8 || (e.mentions || 0) < RANKING_MIN_MENTIONS) return;
            cands.push({ e, t });
        });
        if (cands.length === 0) return renderNewsVoicesFromScores();

        const day = dayNumber == null ? taipeiDayNumber(new Date()) : dayNumber;
        const rnd = seededRng(Math.imul(day, 2654435761) ^ 0x9E3779B9);
        for (let i = cands.length - 1; i > 0; i--) {          // Fisher–Yates，用當天的 seed
            const j = Math.floor(rnd() * (i + 1));
            [cands[i], cands[j]] = [cands[j], cands[i]];
        }
        // 先湊「不同子分類、同品項 1 則、同品牌最多 2 則」；湊不滿 6 則再放寬子分類限制
        const SHOWN = 6, picks = [];
        const usedSub = new Set(), usedItem = new Set(), brandCount = {};
        const fill = relaxSub => {
            for (const x of cands) {
                if (picks.length >= SHOWN) break;
                if (picks.includes(x) || usedItem.has(x.e.name) || (brandCount[x.e.brand] || 0) >= 2) continue;
                if (!relaxSub && usedSub.has(x.e.subcat)) continue;
                picks.push(x); usedSub.add(x.e.subcat); usedItem.add(x.e.name);
                brandCount[x.e.brand] = (brandCount[x.e.brand] || 0) + 1;
            }
        };
        fill(false);
        if (picks.length < SHOWN) fill(true);
        renderVoiceCards(grid, picks, siteData);
    } catch (err) {
        console.error('網友心得載入失敗', err);
        section.remove();
    }
}

// 後備版（原本的做法）：只用 scores-data.json 每品項存的 3 則代表心得，依月份輪替起點。
// 挑「綜合分 3.8 以上、評論量夠、心得 40～300 字、提到該商品、語氣正面、不含 # 標籤堆疊的廣告式文案」的真實心得，
// 同一子分類只取一則、同一品牌最多兩則，依按讚數排序。
async function renderNewsVoicesFromScores() {
    const section = document.getElementById('news-voices-section');
    const grid = document.getElementById('news-voices');
    if (!section || !grid) return;
    try {
        const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
        const pool = [];
        Object.values(scores || {}).forEach(e => {
            if (e.composite == null || e.composite < 3.8 || (e.mentions || 0) < RANKING_MIN_MENTIONS) return;
            // 綜合分門檻 3.8（對應「還不錯」以上）；符合條件的心得本來就少，4.0 只剩 5 則，放寬到 3.8 才湊得出多則。
            // 心得要「在講這個商品」（提到品牌或商品名四字詞）、語氣正面（跟旁邊顯示的高分一致），
            // 且不是 # 標籤堆疊的廣告式文案；寧可少放，也不要放一則負評配高分
            const coreName = (e.name || '').toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
            // 品牌或商品名出現在前 50 字內：節錄只取前 110 字，商品名出現太晚的話，讀者看到的會是在講別款的前半段
            const mentionsItem = x => {
                const lx = x.toLowerCase();
                const hits = [lx.indexOf((e.brand || '').toLowerCase())];
                for (let i = 0; i + 4 <= coreName.length; i++) hits.push(lx.indexOf(coreName.slice(i, i + 4)));
                return hits.some(h => h >= 0 && h <= 50);
            };
            const NEG = /不回購|不推薦|不建議|踩雷|雷品|失望|惡心|欠我|一般般|粉質算一般|不愛|不喜歡|無功無過|過敏|退貨|難用|不好用|不太|沒什麼效果|沒啥效果|拔乾|搓泥|卡粉|平替|有沒有|代購|正品|現貨|下單|私訊|私聊|團購|預購|限時|優惠|來啦/;
            const POS = /回購|好用|喜歡|很愛|巨愛|大愛|推薦|驚豔|驚為|不錯|很好|滿意|舒服|細膩|寶藏|好聞|治癒|本命/;
            const ts = (e.testimonials && e.testimonials.length ? e.testimonials : (e.testimonial ? [e.testimonial] : []))
                .filter(t => t && t.text && t.text.length >= 40 && t.text.length <= 300 && t.text.indexOf('#') === -1
                    && mentionsItem(t.text) && POS.test(t.text) && !NEG.test(t.text));
            if (ts.length === 0) return;
            ts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
            pool.push({ e, t: ts[0] });
        });
        pool.sort((a, b) => (b.t.likes || 0) - (a.t.likes || 0));
        const bySub = new Set(), brandCount = {};
        const uniq = pool.filter(x => {
            if (bySub.has(x.e.subcat) || (brandCount[x.e.brand] || 0) >= 2) return false;
            bySub.add(x.e.subcat); brandCount[x.e.brand] = (brandCount[x.e.brand] || 0) + 1; return true;
        });
        if (uniq.length === 0) { section.remove(); return; }
        const tp = new Date(Date.now() + 8 * 3600 * 1000);
        const SHOWN = 6;
        const offset = (tp.getUTCFullYear() * 12 + tp.getUTCMonth()) * 3 % uniq.length;
        const picks = [];
        for (let i = 0; i < Math.min(SHOWN, uniq.length); i++) picks.push(uniq[(offset + i) % uniq.length]);
        renderVoiceCards(grid, picks, siteData);
    } catch (err) {
        console.error('網友心得載入失敗', err);
        section.remove();
    }
}

// 開架美妝（drugstore-beauty.html）：Olive Young 韓系＋台灣藥妝通路的商品目錄，資料來自 drugstore-products.json。
// 第一版沒有評分與心得（開架品牌尚未跑評論管線），只放品牌、品名、重點；卡片不外連（2026-11-04 使用者決定，等接上評分、做出站內商品頁再連站內）。
// source_url 仍保留在 JSON 裡，之後做站內頁時可用。
// 分類（2026-11-04 使用者定案）：藥妝開架品牌依品牌產地分，Olive Young 依品類分。
// 沒有商品的分類不顯示（台灣品牌、頭髮保養品牌待補）。site-data.json 的 drugstoreMenu 是導覽列下拉，兩邊要同步。
const DRUGSTORE_MENU = [
    { group: 'drug', name: '藥妝開架品牌', en: 'Drugstore', sections: ['台灣品牌', '歐美品牌', '日本品牌', '韓國品牌'] },
    { group: 'olive', name: 'Olive Young', en: 'Olive Young', sections: ['熱門彩妝品牌', '保養品牌', '頭髮保養品牌'] }
];
window.drugstoreState = (() => {
    const st = { group: 'all', section: 'all' };
    try {
        const q = new URLSearchParams(location.search);
        const sec = q.get('section'), grp = q.get('group');
        const hit = DRUGSTORE_MENU.find(g => g.sections.includes(sec));
        if (hit) { st.group = hit.group; st.section = sec; }
        else if (DRUGSTORE_MENU.some(g => g.group === grp)) st.group = grp;
    } catch (e) {}
    return st;
})();

async function renderDrugstore() {
    const list = document.getElementById('drugstore-list');
    const filters = document.getElementById('drugstore-filters');
    if (!list || !filters) return;
    let products = [];
    try {
        const res = await fetch('drugstore-products.json?v=13');
        products = (await res.json()).products || [];
    } catch (err) {
        console.error('drugstore-products.json 載入失敗', err);
    }
    if (products.length === 0) {
        filters.innerHTML = '';
        list.innerHTML = '<div class="text-center text-gray-400 text-sm py-12">商品整理中，敬請期待</div>';
        return;
    }
    const st = window.drugstoreState;
    const has = (g, sec) => products.some(p => p.group === g && p.section === sec);
    const btn = (attr, val, label, on, dark) => `<button type="button" ${attr}="${escHtml(val)}" class="px-5 py-2 rounded-full text-sm font-black transition-colors ${on ? (dark ? 'bg-[#2d2d2d] text-white' : 'bg-[#f2a7b5] text-white') : (dark ? 'bg-white text-gray-500 border border-[#2d2d2d]/20 hover:text-[#2d2d2d]' : 'bg-white text-gray-500 border border-[#f2a7b5]/30 hover:text-[#f2a7b5]')}">${escHtml(label)}</button>`;

    const draw = () => {
        const groupDef = DRUGSTORE_MENU.find(g => g.group === st.group);
        let html = btn('data-group', 'all', '全部', st.group === 'all')
            + DRUGSTORE_MENU.map(g => btn('data-group', g.group, g.name, st.group === g.group)).join('');
        if (groupDef) {
            const secs = groupDef.sections.filter(sec => has(groupDef.group, sec));
            html += '<div class="basis-full h-0"></div>'
                + btn('data-section', 'all', '全部', st.section === 'all', true)
                + secs.map(sec => btn('data-section', sec, sec, st.section === sec, true)).join('');
        }
        filters.innerHTML = html;
        filters.querySelectorAll('button[data-group]').forEach(b => b.addEventListener('click', () => {
            st.group = b.dataset.group; st.section = 'all'; draw();
        }));
        filters.querySelectorAll('button[data-section]').forEach(b => b.addEventListener('click', () => {
            st.section = b.dataset.section; draw();
        }));

        let blocks = '';
        let n = 0;
        DRUGSTORE_MENU.filter(g => st.group === 'all' || st.group === g.group).forEach(g => {
            g.sections.filter(sec => st.section === 'all' || st.section === sec).forEach(sec => {
                const items = products.filter(p => p.group === g.group && p.section === sec);
                if (items.length === 0) return;
                n += items.length;
                blocks += `
            <section class="mb-14">
                <h2 class="text-2xl font-black mb-6 italic border-l-8 border-[#f2a7b5] pl-4">${escHtml(g.en)} / <span class="text-[#f2a7b5] text-lg not-italic">${escHtml(sec)}</span></h2>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                    ${items.map((p, i) => `
                    <a href="drugstore-detail.html?p=${encodeURIComponent(p.slug)}" class="bg-white rounded-2xl overflow-hidden border border-[#f2a7b5]/15 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                        ${newProductImageBlock(p, i)}
                        <div class="p-3 md:p-5 flex flex-col flex-grow">
                            <div class="mb-2">
                                <span class="${BRAND_BADGE_COLORS[i % BRAND_BADGE_COLORS.length]} text-white text-[10px] font-black px-3 py-1 rounded-full tracking-wide">${escHtml(p.brand)}</span>
                            </div>
                            <h3 class="font-black text-sm md:text-base leading-snug mb-1 line-clamp-2">${escHtml(p.name)}</h3>
                            <p class="hidden md:block text-xs text-gray-500 leading-relaxed line-clamp-3">${escHtml(p.highlight || '')}</p>
                        </div>
                    </a>`).join('')}
                </div>
            </section>`;
            });
        });
        list.innerHTML = blocks || '<div class="text-center text-gray-400 text-sm py-12">這個分類商品整理中，敬請期待</div>';
    };
    draw();
}

// 保養專欄分類/標籤篩選狀態。category: undefined=尚未從網址初始化, null=全部文章；tag: null=不篩選標籤
window.blogFilterState = { category: undefined, tag: undefined };

// 保養專欄列表（與首頁輪播同一份 articles.json，確保「輪播＝專欄最新文章」不會不同步）
// （news.html 已改用 renderWeeklyNews()，不再共用這個 function）
async function renderSkincareArticles() {
    const list = document.getElementById('skincare-article-list');
    if (!list) return;

    const allArticles = await getArticles();
    if (allArticles.length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-sm py-8">尚無文章</div>';
        return;
    }

    const tabsContainer = document.getElementById('category-tabs');
    const tagContainer = document.getElementById('tag-filters');

    let filtered = allArticles;

    if (tabsContainer) {
        if (window.blogFilterState.category === undefined) {
            const params = new URLSearchParams(window.location.search);
            window.blogFilterState.category = params.get('category') || null;
        }

        // 「活動快訊」跟保養專欄共用這個列表頁模板，但不該掛著「Skincare Column /
        // 保養專欄」的標題，所以篩到 category=活動 時換成活動快訊自己的標題。
        //
        // 分類頁籤原本在這個情況下會一起隱藏，理由是「改用下面的 tag-filters 在
        // 週年慶/母親節/Olive Young促銷之間切換就好」。但那批標籤從來沒長出來——
        // 5 篇活動文章全部都是 #週年慶，標籤排只會浮一顆沒有作用的按鈕出來，
        // 結果是進到活動快訊之後畫面上完全沒有任何可以切回其他分類的東西，
        // 只能走上方選單或改網址。頁籤現在一律顯示，活動快訊跟保養專欄一樣可以
        // 直接在分類之間互相切換。
        const heading = document.getElementById('blog-page-heading');
        const isEventCategory = window.blogFilterState.category === '活動';
        if (heading) {
            heading.innerHTML = isEventCategory
                ? 'Event Center / <span class="text-[#f2a7b5] text-2xl not-italic">活動快訊</span>'
                : 'Skincare Column / <span class="text-[#f2a7b5] text-2xl not-italic">保養專欄</span>';
        }
        // 畫面標題換了，瀏覽器分頁標題與 meta 也要跟著換；原本只換 H1，分頁標題仍是
        // 「保養專欄 | Glow Makeup」，跟畫面對不上。canonical 一併指向自己：不然這一頁
        // 對外宣告自己是保養專欄列表的複本，換了標題也不會被 Google 採用。
        if (isEventCategory) {
            const eventUrl = 'https://www.theglowmakeup.org/skincare-blog.html?category=' + encodeURIComponent('活動');
            const eventTitle = '活動快訊 | Glow Makeup';
            const eventDesc = 'Glow Makeup 活動快訊：百貨週年慶與檔期優惠整理，活動時間與內容一次看。';
            document.title = eventTitle;
            const setMeta = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
            setMeta('meta[name="description"]', 'content', eventDesc);
            setMeta('meta[property="og:title"]', 'content', eventTitle);
            setMeta('meta[property="og:description"]', 'content', eventDesc);
            setMeta('link[rel="canonical"]', 'href', eventUrl);
        }
        tabsContainer.style.display = '';
        renderCategoryTabs(allArticles, tabsContainer);
        if (window.blogFilterState.category) {
            filtered = filtered.filter(a => a.category === window.blogFilterState.category);
        }
    }

    if (tagContainer) {
        if (window.blogFilterState.tag === undefined) {
            const params = new URLSearchParams(window.location.search);
            window.blogFilterState.tag = params.get('tag') || null;
        }
        renderTagFilters(filtered, tagContainer);
        if (window.blogFilterState.tag) {
            filtered = filtered.filter(a => a.tag === window.blogFilterState.tag);
        }
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="text-gray-400 text-sm py-8">這個分類／標籤目前還沒有文章</div>';
        return;
    }

    list.innerHTML = filtered.map(a => `
        <div class="article-list-item cursor-pointer" onclick="location.href='${a.url || '#'}'">
            <img src="${a.image}" class="article-list-img" alt="${a.title}">
            <div>
                <span class="text-xs font-black text-gray-400">${formatArticleDate(a.date)}${a.tag ? ' · #' + a.tag : ''}</span>
                <h2 class="text-2xl font-black mt-2 mb-4">${a.title}</h2>
                <p class="text-gray-500 line-clamp-2">${a.excerpt || ''}</p>
            </div>
        </div>
    `).join('');
}

// 分類頁籤（保養/清潔/化妝），依實際文章的 category 欄位動態產生，跟 Menu bar 下拉選單的分類同步
function renderCategoryTabs(allArticles, container) {
    const categories = [...new Set(allArticles.map(a => a.category).filter(Boolean))];
    const current = window.blogFilterState.category;
    const tabs = [{ label: '全部文章', value: null }, ...categories.map(c => ({ label: c, value: c }))];
    container.innerHTML = tabs.map(t => {
        const active = t.value === current;
        const cls = active
            ? 'bg-[#f2a7b5] text-white'
            : 'bg-white border border-gray-100 text-gray-600 hover:bg-[#f2a7b5] hover:text-white';
        return `<button onclick="setBlogCategory(${t.value ? `'${t.value}'` : 'null'})" class="${cls} px-5 py-1.5 rounded-full text-sm font-bold transition-colors">${t.label}</button>`;
    }).join('');
}

// 標籤篩選：比分類更細，依「目前分類篩選後」的文章動態列出有出現過的標籤，點擊可切換篩選
function renderTagFilters(articlesInCategory, container) {
    const tags = [...new Set(articlesInCategory.map(a => a.tag).filter(Boolean))];

    // 目前這個分類裡根本沒有這個標籤（例如網址帶著別的分類才有的 ?tag=），
    // 留著會篩出一片空白、而且下面那排按鈕裡沒有它可以再點一次取消，直接重置掉。
    if (window.blogFilterState.tag && !tags.includes(window.blogFilterState.tag)) {
        window.blogFilterState.tag = null;
    }

    // 只剩一個標籤時照樣顯示（活動快訊的 #週年慶 就是這個情形）。它在原地點下去雖然
    // 篩不掉東西，但它是別處連過來的落點——從「全部文章」點 #週年慶 會帶到活動快訊，
    // 到站之後要看得到那顆標籤是亮著的，才知道自己現在被篩在哪裡。
    if (tags.length === 0) {
        container.innerHTML = '';
        return;
    }
    const current = window.blogFilterState.tag;
    container.innerHTML = tags.map(t => {
        const active = t === current;
        const cls = active
            ? 'bg-[#2d2d2d] text-white'
            : 'bg-[#fdeef1] text-[#e6a0ad] hover:bg-[#2d2d2d] hover:text-white';
        return `<button onclick="setBlogTag('${t}')" class="${cls} px-4 py-1.5 rounded-full text-sm font-black transition-colors">#${t}</button>`;
    }).join('');
}

window.setBlogCategory = function (cat) {
    window.blogFilterState.category = cat;
    window.blogFilterState.tag = null; // 切換分類時重置標籤篩選，避免卡在上個分類才有的標籤
    const url = new URL(window.location);
    if (cat) url.searchParams.set('category', cat); else url.searchParams.delete('category');
    window.history.replaceState({}, '', url);
    renderSkincareArticles();
};

// 這個標籤底下的文章是不是全部都屬於指定分類
function tagBelongsOnlyTo(tag, category) {
    const tagged = (articlesCache || []).filter(a => a.tag === tag);
    return tagged.length > 0 && tagged.every(a => a.category === category);
}

window.setBlogTag = function (tag) {
    // 再點一次同一個標籤 = 取消篩選
    const turningOff = window.blogFilterState.tag === tag;
    window.blogFilterState.tag = turningOff ? null : tag;

    // 「活動快訊」是獨立的目的地頁（有自己的 Event Center 標題），不是保養專欄底下的
    // 一個篩選結果。所以在別的分類（例如「全部文章」）點到只屬於活動的標籤時，要連分類
    // 一起切成「活動」，直接把人帶到活動快訊那一頁，而不是停在「保養專欄」的標題底下
    // 顯示一批活動文章。
    //
    // 只對活動這樣做：目前只有它有自己的頁面識別。其他分類的標籤維持原地篩選，否則
    // 從「全部文章」點 #面膜 會被鎖進保養分類，底下的標籤排跟著縮成保養那 13 個，
    // 想再跳去 #香水 就得先切回全部文章，反而更難用。
    if (!turningOff && window.blogFilterState.category !== '活動' && tagBelongsOnlyTo(tag, '活動')) {
        window.blogFilterState.category = '活動';
        const url = new URL(window.location);
        url.searchParams.set('category', '活動');
        window.history.replaceState({}, '', url);
    }

    renderSkincareArticles();
};

// 首頁熱門榜單：依產品類別（subcat）分頁籤，各頁籤顯示該類別 Top5（真實綜合分，需評論量足夠）
const RANKING_MIN_MENTIONS = 20;
const RANKING_MIN_ITEMS_FOR_TAB = 3;
const RANKING_TOP_N = 5;

async function initRankings() {
    const tabsEl = document.getElementById('ranking-tabs');
    const grid = document.getElementById('rankings-grid');
    if (!grid) return;

    let [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    if (!scores) {
        grid.innerHTML = '<div class="text-gray-400 text-sm">無法載入評分資料</div>';
        return;
    }
    if (!siteData) {
        siteDataCache = null; // 上一次抓取失敗不快取，重試一次再放棄（避免圖片全部退回佔位圖）
        siteData = await getSiteData();
    }

    const bySubcat = {};
    Object.values(scores).forEach(e => {
        if (e.composite != null && (e.mentions || 0) >= RANKING_MIN_MENTIONS) {
            (bySubcat[e.subcat] = bySubcat[e.subcat] || []).push(e);
        }
    });

    const categories = Object.keys(bySubcat)
        .filter(s => bySubcat[s].length >= RANKING_MIN_ITEMS_FOR_TAB)
        .sort((a, b) => bySubcat[b].length - bySubcat[a].length);

    if (categories.length === 0) {
        grid.innerHTML = '<div class="text-gray-400 text-sm">評分資料累積中，敬請期待</div>';
        if (tabsEl) tabsEl.innerHTML = '';
        return;
    }

    window.__rankingBySubcat = bySubcat;
    window.__rankingSiteData = siteData;
    window.__currentRankingSubcat = categories[0];

    if (tabsEl) {
        tabsEl.innerHTML = categories.map(s => {
            return `<button onclick="switchRankingTab(this.dataset.subcat)" data-subcat="${s}" class="ranking-tab-btn shrink-0 pb-3 font-black text-sm md:text-base border-b-2 border-transparent text-gray-400 hover:text-[#f2a7b5] transition-colors whitespace-nowrap">${s} TOP${RANKING_TOP_N}</button>`;
        }).join('');
    }

    renderRankingGrid();
}

function switchRankingTab(subcat) {
    window.__currentRankingSubcat = subcat;
    renderRankingGrid();
    const activeBtn = document.querySelector(`.ranking-tab-btn[data-subcat="${CSS.escape(subcat)}"]`);
    if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function scrollRankingTabs(direction) {
    const track = document.getElementById('ranking-tabs');
    if (!track) return;
    track.scrollBy({ left: track.clientWidth * 0.6 * direction, behavior: 'smooth' });
}

function renderRankingGrid() {
    const grid = document.getElementById('rankings-grid');
    const tabsEl = document.getElementById('ranking-tabs');
    const bySubcat = window.__rankingBySubcat;
    const currentSubcat = window.__currentRankingSubcat;
    if (!grid || !bySubcat || !currentSubcat) return;

    if (tabsEl) {
        Array.from(tabsEl.children).forEach(btn => {
            const active = btn.dataset.subcat === currentSubcat;
            btn.classList.toggle('border-[#f2a7b5]', active);
            btn.classList.toggle('text-[#2d2d2d]', active);
            btn.classList.toggle('border-transparent', !active);
            btn.classList.toggle('text-gray-400', !active);
        });
    }

    const items = bySubcat[currentSubcat]
        .slice()
        .sort((a, b) => (b.composite - a.composite) || (b.mentions - a.mentions))
        .slice(0, RANKING_TOP_N);

    const siteData = window.__rankingSiteData;
    grid.innerHTML = items.map((e, i) => {
        const img = findItemImage(siteData, e.subcat, e.brand, e.name);
        const rankBg = i === 0 ? 'bg-[#2d2d2d] text-white' : i < 3 ? 'bg-[#f2a7b5] text-white' : 'bg-gray-200 text-[#2d2d2d]';
        return `
            <a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=board" class="relative bg-white border border-gray-100 rounded-2xl p-3 md:p-4 hover:border-[#f2a7b5]/50 hover:shadow-md transition-all group">
                <div class="absolute top-2.5 left-2.5 md:top-3 md:left-3 z-10 w-6 h-6 md:w-7 md:h-7 ${rankBg} rounded-full flex items-center justify-center font-black text-xs italic">${i + 1}</div>
                <div class="aspect-square bg-gray-50 rounded-xl overflow-hidden mb-3 flex items-center justify-center p-3 md:p-4">
                    <img ${thumbAttrs(img)} decoding="async" class="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" alt="${e.name}">
                </div>
                <p class="text-[10px] font-black text-gray-400 uppercase tracking-wide mb-1 truncate">${e.brand}</p>
                <h3 class="font-black text-xs md:text-sm leading-snug mb-2 line-clamp-2 group-hover:text-[#f2a7b5] transition-colors" title="${e.name}">${e.name}</h3>
                <div class="flex items-center gap-1.5 text-xs">
                    <span class="text-[#e05a47] font-black">★ ${e.composite.toFixed(1)}</span>
                    <span class="text-gray-400 text-[11px]">(${e.mentions}則)</span>
                </div>
            </a>
        `;
    }).join('');
}

function goToSlide(index) {
    const track = document.getElementById('mainSlider');
    const dotsContainer = document.getElementById('sliderDots');
    if (!track) return;
    
    const slides = track.children.length;
    currentSlide = index % slides;
    track.style.transform = `translateX(-${currentSlide * 100}%)`;
    
    if (dotsContainer) {
        const dots = dotsContainer.children;
        for (let i = 0; i < dots.length; i++) {
            if (i === currentSlide) {
                dots[i].classList.remove('opacity-40');
                dots[i].classList.add('opacity-100');
            } else {
                dots[i].classList.add('opacity-40');
                dots[i].classList.remove('opacity-100');
            }
        }
    }
    
    clearInterval(sliderInterval);
    sliderInterval = setInterval(() => {
        goToSlide((currentSlide + 1) % slides);
    }, 4000);
}

function prevSlide() {
    const track = document.getElementById('mainSlider');
    if (!track) return;
    const slides = track.children.length;
    goToSlide((currentSlide - 1 + slides) % slides);
}

function nextSlide() {
    const track = document.getElementById('mainSlider');
    if (!track) return;
    const slides = track.children.length;
    goToSlide((currentSlide + 1) % slides);
}

// 2. Quiz Logic (首頁「今天需要什麼美妝協助嗎」— 3 類別各自接不同的第二步追問，
//    第二步選項與最終建議都串真實資料 articles.json / scores-data.json，不使用假造內容)

// 「挑選底妝困難」分類的第三題：把「妳最在意的問題是？」對應到 scores-data.json 裡
// 該子分類真實存在的指標鍵名（來源：csv/Indicator.csv，鍵名已核對過 scores-data.json 實際資料），
// 並附上跟該痛點相關的文章 id（來自 articles.json，供結果頁下方「妳可能也想看」使用）
const PAIN_POINT_CONFIG = {
    '粉底液': [
        { label: '容易出油脫妝', indicator: '控油力', articles: ['waterproof-summer-makeup', 'setting-method-comparison'] },
        { label: '蓋不住痘疤瑕疵', indicator: '遮瑕力', articles: ['concealer-stick-vs-liquid'] },
        { label: '感覺厚重不透氣', indicator: '輕透度', articles: ['bare-faced-makeup-2026'] },
        { label: '一直卡粉飛粉', indicator: '成膜度', articles: ['primer-caking-whitecast', 'cushion-foundation-guide'] }
    ],
    '氣墊粉餅': [
        { label: '容易出油脫妝', indicator: '控油力', articles: ['cushion-foundation-guide'] },
        { label: '蓋不住痘疤瑕疵', indicator: '遮瑕力', articles: ['cushion-foundation-guide', 'concealer-stick-vs-liquid'] },
        { label: '感覺厚重悶', indicator: '輕透度', articles: ['bare-faced-makeup-2026'] },
        { label: '一直卡粉', indicator: '成膜度', articles: ['cushion-foundation-guide', 'setting-method-comparison'] }
    ],
    '遮瑕膏': [
        { label: '蓋不住黑眼圈/痘疤', indicator: '遮蓋力', articles: ['concealer-stick-vs-liquid'] },
        { label: '用一下就脫落', indicator: '持久度', articles: ['concealer-stick-vs-liquid'] },
        { label: '顏色會變黃暗沉', indicator: '不暗沉變色', articles: ['concealer-stick-vs-liquid'] },
        { label: '卡在細紋裡', indicator: '抗紋力', articles: ['concealer-stick-vs-liquid'] }
    ],
    '妝前乳': [
        { label: '容易出油', indicator: '控油力', articles: ['primer-caking-whitecast'] },
        { label: '毛孔還是很明顯', indicator: '毛孔隱形', articles: ['primer-caking-whitecast'] },
        { label: '之後上妝會卡粉', indicator: '底妝相容性', articles: ['primer-caking-whitecast'] },
        { label: '膚色不均暗沉', indicator: '抗暗沉', articles: ['primer-caking-whitecast'] }
    ]
};
const PAIN_POINT_MIN_MENTIONS = 10;

const HOME_QUIZ_CONFIG = {
    '缺乏保養知識': {
        question: '妳最近的困擾是什麼？',
        options: ['新手不知道怎麼挑', '搓泥卡粉厚重', '脫妝不持久‧暈染掉色', '脫皮乾燥‧刺激泛紅', '想學新妝容', '致痘毛孔粉刺'],
        async hasData(value) {
            const articles = await getArticles();
            return articles.some(a => (a.concerns || []).includes(value));
        },
        async buildResult(value) {
            const articles = await getArticles();
            const matched = articles.filter(a => (a.concerns || []).includes(value)).slice(0, 3);
            const list = matched.length
                ? matched.map(a => `<a href="${a.url}" class="text-[#f2a7b5] font-bold block mt-2">${a.title} ➔</a>`).join('')
                : '<p class="text-gray-400 text-sm mt-2">此主題文章準備中</p>';
            return {
                title: `為妳推薦：「${value}」相關文章`,
                html: `${list}<br><a href="skincare-blog.html" class="text-[#f2a7b5] font-bold">查看全部保養文章 ➔</a>`
            };
        }
    },
    '挑選底妝困難': {
        question: '妳想找哪種底妝？',
        options: ['粉底液', '氣墊粉餅', '遮瑕膏', '妝前乳'],
        async hasData(value) {
            return (await topItemsForSubcat(value, 1)).length > 0;
        },
        // 第三題：痛點清單是固定表（見上方 PAIN_POINT_CONFIG），4 個子分類都已定義完整選項，固定要問
        async step3(value) {
            const painPoints = PAIN_POINT_CONFIG[value];
            if (!painPoints) return null;
            return { question: '妳最在意的問題是？', options: painPoints.map(p => p.label) };
        },
        async buildResult(value, painPointLabel) {
            const conf = PAIN_POINT_CONFIG[value] || [];
            const pp = conf.find(p => p.label === painPointLabel);

            const items = pp ? await topItemsForSubcatByIndicator(value, pp.indicator, 2, PAIN_POINT_MIN_MENTIONS) : [];
            const list = items.length
                ? items.map(e => {
                    const score = e.indicators[pp.indicator];
                    return `<a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=board" class="text-[#f2a7b5] font-bold block mt-2">${e.brand} ${e.name}（${pp.indicator} ${score.toFixed(1)} <span class="text-gray-400 font-normal text-xs">‧總分 ${e.composite.toFixed(1)}</span>）➔</a>`;
                }).join('')
                : '<p class="text-gray-400 text-sm mt-2">此分類評分資料建置中</p>';

            // 結果下方附相關文章，承接「還想多了解一點」的訪客；沒有可用文章的組合直接不顯示這區塊，
            // 不放「準備中」佔位（商品推薦本身已是完整結果，不需要為了硬塞文章而顯得像未完成）
            let articlesHtml = '';
            if (pp && pp.articles && pp.articles.length) {
                const allArticles = await getArticles();
                const related = pp.articles.map(id => allArticles.find(a => a.id === id)).filter(Boolean).slice(0, 2);
                if (related.length) {
                    articlesHtml = `
                        <div class="mt-6 pt-6 border-t border-gray-100 text-left">
                            <p class="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">📖 妳可能也想看</p>
                            ${related.map(a => `<a href="${a.url}" class="text-[#f2a7b5] font-bold block mt-1 text-sm">${a.title} ➔</a>`).join('')}
                        </div>
                    `;
                }
            }

            const label = pp ? `「${pp.indicator}」評價最好的${value}` : `社群高分「${value}」`;
            return { title: `為妳推薦：${label}`, html: `依真實社群評分，這幾款最受好評：${list}${articlesHtml}` };
        }
    },
    '美妝工具選擇': {
        question: '妳想了解哪類工具？',
        options: ['粉底刷', '海綿粉撲', '睫毛夾'],
        async hasData(value) {
            return (await topItemsForSubcat(value, 1)).length > 0;
        },
        async buildResult(value) {
            const items = await topItemsForSubcat(value, 2);
            const list = items.length
                ? items.map(e => `<a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=board" class="text-[#f2a7b5] font-bold block mt-2">${e.brand} ${e.name}（★${e.composite.toFixed(1)}）➔</a>`).join('')
                : '<p class="text-gray-400 text-sm mt-2">此分類評分資料建置中</p>';
            return { title: `為妳推薦：社群高分「${value}」`, html: `依真實社群評分，這幾款最受好評：${list}` };
        }
    }
};

function selectOption(card) {
    const step = card.closest('.quiz-step');
    step.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected', 'border-[#f2a7b5]'));
    card.classList.add('selected', 'border-[#f2a7b5]');
}

// 測驗選項卡片的標題標籤會隨頁面標題層級調整而變動（2026-10-12 由 h4 改成 h3，
// 因為它的上層是 H2 區塊標題），所以這裡用「標籤無關」的選法取卡片文字。
// 之前是把標籤名寫死在選擇器裡，改層級時整個首頁測驗會在 initHomeQuizVisibility
// 直接丟 TypeError，而且畫面上不會有任何症狀，只有 console 看得到。
function optionCardLabel(card) {
    if (!card) return '';
    const heading = card.querySelector('h1, h2, h3, h4, h5, h6');
    return heading ? heading.innerText : '';
}

function nextStep(current) {
    const currentStep = document.querySelector(`.quiz-step[data-step="${current}"]`);
    const selected = currentStep.querySelector('.option-card.selected');

    if (!selected) {
        alert('請選擇一個選項！');
        return;
    }

    if (current === 1) {
        const category = optionCardLabel(selected);
        renderQuizStep2(category);
        currentStep.classList.add('hidden');
        return;
    }

    if (current === 2) {
        const category = optionCardLabel(document.querySelector('.quiz-step[data-step="1"] .option-card.selected'));
        const value = selected.dataset.value;
        const config = HOME_QUIZ_CONFIG[category];
        currentStep.classList.add('hidden');
        if (typeof config.step3 === 'function') {
            renderQuizStep3(category, value);
        } else {
            showResult(category, value);
        }
        return;
    }

    if (current === 3) {
        const category = optionCardLabel(document.querySelector('.quiz-step[data-step="1"] .option-card.selected'));
        const value = currentStep.dataset.parentValue;
        const tag = selected.dataset.value;
        currentStep.classList.add('hidden');
        showResult(category, value, tag);
    }
}

// 依選定的類別，動態產生該類別專屬的第二步問題與選項（3 個類別各自不同，不是同一份選項）。
// 選項會先過濾掉完全沒有真實評分/文章資料的（例如目前刷具類還沒評分完），避免使用者選了卻走進死路。
async function renderQuizStep2(category) {
    const step2 = document.getElementById('quiz-step-2');
    const config = HOME_QUIZ_CONFIG[category];
    if (!step2 || !config) return;

    const availability = await Promise.all(config.options.map(opt => config.hasData(opt)));
    const availableOptions = config.options.filter((_, i) => availability[i]);

    document.getElementById('quiz-step2-question').innerText = config.question;
    document.getElementById('quiz-step2-options').innerHTML = availableOptions.length
        ? availableOptions.map(opt => `
            <div class="option-card border-2 border-gray-100 px-8 py-6 rounded-3xl cursor-pointer hover:border-[#f2a7b5] transition-all" data-value="${opt}" onclick="selectOption(this)">
                <h3 class="font-bold text-lg">${opt}</h3>
            </div>
        `).join('')
        : '<p class="text-gray-400 text-sm">此類別評分資料建置中，敬請期待</p>';
    step2.classList.remove('hidden');
}

// 依選定的類別＋第二步的值，動態產生第三題（若該類別沒有 step3 邏輯或資料不夠多元，
// step3() 會回傳 null，這裡就直接跳過第三題進結果，不強塞裝飾性問題）
async function renderQuizStep3(category, value) {
    const config = HOME_QUIZ_CONFIG[category];
    const step3Data = await config.step3(value);
    if (!step3Data || !step3Data.options || step3Data.options.length < 2) {
        showResult(category, value);
        return;
    }
    const step3 = document.getElementById('quiz-step-3');
    if (!step3) { showResult(category, value); return; }
    step3.dataset.parentValue = value;
    document.getElementById('quiz-step3-question').innerText = step3Data.question;
    document.getElementById('quiz-step3-options').innerHTML = step3Data.options.map(opt => `
        <div class="option-card border-2 border-gray-100 px-8 py-6 rounded-3xl cursor-pointer hover:border-[#f2a7b5] transition-all" data-value="${opt}" onclick="selectOption(this)">
            <h3 class="font-bold text-lg">${opt}</h3>
        </div>
    `).join('');
    step3.classList.remove('hidden');
}

function quizBack(fromStep) {
    const from = fromStep || 2;
    document.getElementById(`quiz-step-${from}`).classList.add('hidden');
    if (from <= 2) {
        document.querySelector('.quiz-step[data-step="1"]').classList.remove('hidden');
    } else {
        document.getElementById(`quiz-step-${from - 1}`).classList.remove('hidden');
    }
}

function showResult(category, value, tag) {
    const resultStep = document.getElementById('quiz-result');
    if (!resultStep) return;
    resultStep.classList.remove('hidden');
    resultStep.classList.add('active');

    const resultTitle = document.getElementById('result-title');
    const resultText = document.getElementById('result-text');
    if (resultTitle) resultTitle.innerText = '分析中...';
    if (resultText) resultText.innerHTML = '';

    HOME_QUIZ_CONFIG[category].buildResult(value, tag).then(({ title, html }) => {
        if (resultTitle) resultTitle.innerText = title;
        if (resultText) resultText.innerHTML = html;
    });
}

function resetQuiz() {
    const resultStep = document.getElementById('quiz-result');
    const step2 = document.getElementById('quiz-step-2');
    const step3 = document.getElementById('quiz-step-3');
    const firstStep = document.querySelector('.quiz-step[data-step="1"]');
    resultStep.classList.add('hidden');
    step2.classList.add('hidden');
    if (step3) step3.classList.add('hidden');
    firstStep.classList.remove('hidden');
    firstStep.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected', 'border-[#f2a7b5]'));
}

// 若某個第一步類別底下所有選項都完全沒有真實評分/文章資料（例如刷具類還沒評分完），
// 整張卡片直接隱藏，不讓使用者選了才發現走進死路
async function initHomeQuizVisibility() {
    const step1 = document.querySelector('.quiz-step[data-step="1"]');
    if (!step1) return;

    const cards = [...step1.querySelectorAll('.option-card')];
    await Promise.all(cards.map(async card => {
        const category = optionCardLabel(card);
        const config = HOME_QUIZ_CONFIG[category];
        if (!config) return;
        const availability = await Promise.all(config.options.map(opt => config.hasData(opt)));
        if (!availability.some(Boolean)) card.classList.add('hidden');
    }));
}

// 5. Cruel Battle 殘酷擂台（真實資料版：composite/indicators/testimonial 全部來自 scores-data.json）

// 殘酷擂台：分類按鈕與可選商品全部由 scores-data.json 自動產生（有真實綜合分的品項才能上擂台，
// 至少 2 個才會有該分類）。下面這幾個分類固定排最前面，並用原本的標題；其餘依品項數由多到少排。
const BATTLE_PINNED = ['蜜粉', '乳液', '眼影/眼影盤'];
const BATTLE_TITLES = {
    '蜜粉': '2026 年度蜜粉定妝大戰',
    '乳液': '2026 年度乳液保濕力對決',
    '眼影/眼影盤': '2026 年度眼影盤顯色大戰'
};
// 目前擂台狀態：分類、該分類所有可選品項（分數高到低）、左右兩側
const battleState = { subcat: null, items: [], left: null, right: null };

let siteDataCache = null;
let scoresDataCache = null;

// 同 getArticles：共用進行中的請求；失敗時清掉，下次呼叫會重試（initRankings 就靠這個重試一次）
let siteDataPromise = null;
let scoresDataPromise = null;

async function getSiteData() {
    if (siteDataCache) return siteDataCache;
    if (!siteDataPromise) {
        siteDataPromise = (async () => {
            try {
                const response = await fetch('site-data.json?v=43');
                siteDataCache = await response.json();
                return siteDataCache;
            } catch (err) {
                console.error('Error fetching site data:', err);
                siteDataPromise = null;
                return null;
            }
        })();
    }
    return siteDataPromise;
}

async function getScoresData() {
    if (scoresDataCache) return scoresDataCache;
    if (!scoresDataPromise) {
        scoresDataPromise = (async () => {
            try {
                const response = await fetch('scores-data.json?v=47');
                scoresDataCache = await response.json();
                return scoresDataCache;
            } catch (err) {
                console.error('Error fetching scores data:', err);
                scoresDataPromise = null;
                return null;
            }
        })();
    }
    return scoresDataPromise;
}

// 找該品項在 site-data.json 裡的圖片（scores-data 本身不存圖）
function findItemImage(siteData, subcategory, brand, name) {
    const items = siteData?.subcategoryDetails?.[subcategory]?.items || [];
    const found = items.find(it => it.brand === brand && it.name === name);
    return (found && (found.image || found.img)) || '';
}

// 小卡片（熱門榜單、網友怎麼說、聚光卡）用縮圖，不載 1MB 的原圖：
// assets/products/xxx.png → assets/products/thumb/xxx.webp（由 make_product_thumbs.py 產生，新增商品圖後要跑一次）。
// 縮圖不存在或載入失敗時 onerror 會退回原圖，所以漏跑腳本只是沒加速，不會壞圖。商品頁大圖不受影響。
function thumbOf(path) {
    const m = /^assets\/products\/([^\/]+)\.[a-z0-9]+$/i.exec(path || '');
    return m ? `assets/products/thumb/${m[1]}.webp` : (path || '');
}
function thumbAttrs(full) {
    if (!full) return 'src=""';
    const t = thumbOf(full);
    if (t === full) return `src="${escHtml(full)}"`;
    return `src="${escHtml(t)}" onerror="this.onerror=null;this.src='${escHtml(full)}'"`;
}

// 取該子分類真實綜合分前 N 名，各自帶上圖片
async function topItemsForSubcat(subcategory, limit = 2) {
    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    if (!scores) return [];
    const candidates = Object.values(scores).filter(e => e.subcat === subcategory && e.composite != null);
    candidates.sort((a, b) => b.composite - a.composite);
    return candidates.slice(0, limit).map(e => ({
        ...e,
        img: findItemImage(siteData, subcategory, e.brand, e.name)
    }));
}
async function topTwoForSubcat(subcategory) { return topItemsForSubcat(subcategory, 2); }

// 依指定指標分數（而非總分）排序取前 N 名，用於首頁問卷「痛點→指標」推薦。
// 強制套用最低樣本門檻：切到單一指標排序後，樣本量小的品項在該指標飆高分的風險比總分排序更高
// （CLAUDE.md 已記錄過 Bobbi Brown 隔離霜 1 則評論卻顯示 5.0 分的問題），不能不設下限。
async function topItemsForSubcatByIndicator(subcategory, indicatorKey, limit = 2, minMentions = 10) {
    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    if (!scores) return [];
    const candidates = Object.values(scores).filter(e =>
        e.subcat === subcategory &&
        e.indicators && e.indicators[indicatorKey] != null &&
        (e.mentions || 0) >= minMentions
    );
    candidates.sort((a, b) => b.indicators[indicatorKey] - a.indicators[indicatorKey]);
    return candidates.slice(0, limit).map(e => ({
        ...e,
        img: findItemImage(siteData, subcategory, e.brand, e.name)
    }));
}

// 取全站真實綜合分前 N 名（需評論量足夠，同首頁 Top5 榜單的門檻），跨子分類
async function topItemsOverall(limit = 4, minMentions = RANKING_MIN_MENTIONS) {
    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    if (!scores) return [];
    const candidates = Object.values(scores).filter(e => e.composite != null && (e.mentions || 0) >= minMentions);
    candidates.sort((a, b) => (b.composite - a.composite) || (b.mentions - a.mentions));
    return candidates.slice(0, limit).map(e => ({
        ...e,
        img: findItemImage(siteData, e.subcat, e.brand, e.name)
    }));
}

// 專櫃美妝／精選評比 landing 頁用：真實 Top 商品卡片（board=討論則數、review=綜合評分）
function spotlightCardHtml(e, mode) {
    const href = `item-detail.html?item=${encodeURIComponent(e.name)}&from=${mode}`;
    const badge = mode === 'board'
        ? `<span class="text-xs font-bold text-[#f2a7b5] bg-[#f2a7b5]/10 px-2.5 py-1 rounded-full">🔥 ${e.mentions} 則真實討論</span>`
        : `<div class="flex items-center gap-1 bg-[#f2a7b5]/10 px-2 py-0.5 rounded-full text-xs font-bold text-[#f2a7b5]"><span>★ ${e.composite.toFixed(1)}</span><span class="text-xs text-gray-500 font-normal">(${e.mentions} 則提及)</span></div>`;
    const cta = mode === 'board' ? '進入看詳細看板介紹與知識點 ➔' : '查看各項性能指標網友綜合得分 ➔';
    const quote = e.testimonial
        ? `「${e.testimonial.text.slice(0, 70)}${e.testimonial.text.length > 70 ? '…' : ''}」`
        : `真實社群綜合評分 ${e.composite.toFixed(1)} 分，${e.subcat}類別中的高分之選。`;
    return `
        <a href="${href}" class="bg-white rounded-[32px] p-6 border border-[#f2a7b5]/10 shadow-sm hover:shadow-lg transition-all group flex flex-col sm:flex-row gap-6 items-stretch">
            <div class="w-full sm:w-2/5 aspect-square sm:aspect-auto bg-[#fff9f5] rounded-2xl p-4 overflow-hidden flex items-center justify-center border border-[#f2a7b5]/10 shrink-0">
                <img ${thumbAttrs(e.img)} alt="${e.brand}" class="max-w-full max-h-[160px] object-contain group-hover:scale-105 transition-transform duration-500">
            </div>
            <div class="flex flex-col justify-between py-2">
                <div>
                    <div class="flex justify-between items-center gap-2 mb-2">
                        <span class="text-xs font-black tracking-widest text-gray-500 uppercase">${e.brand}</span>
                        ${badge}
                    </div>
                    <h2 class="font-black text-xl text-[#2d2d2d] group-hover:text-[#f2a7b5] transition-colors mb-2">${e.name}</h2>
                    <p class="text-xs text-gray-500 leading-relaxed line-clamp-3">${quote}</p>
                </div>
                <span class="text-xs font-bold text-[#f2a7b5] mt-4 flex items-center gap-1 group-hover:translate-x-1 transition-transform">${cta}</span>
            </div>
        </a>
    `;
}

// 專櫃美妝頁的品牌篩選：有討論量門檻（同榜單）的商品才列出，依討論則數排序；全部＝原本的熱門前 4 名
const BOARD_BRAND_PREVIEW = 8;

async function renderBoardBrands(container, filters) {
    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    const pool = Object.values(scores || {}).filter(e => e.composite != null && (e.mentions || 0) >= RANKING_MIN_MENTIONS);
    if (pool.length === 0) { filters.innerHTML = ''; return; }
    const byBrand = {};
    pool.forEach(e => { (byBrand[e.brand] = byBrand[e.brand] || []).push(e); });
    const brands = Object.keys(byBrand).sort((a, b) => byBrand[b].length - byBrand[a].length);
    let current = 'all', expanded = false;
    try { const b = new URLSearchParams(location.search).get('brand'); if (byBrand[b]) current = b; } catch (e) {}

    const draw = () => {
        filters.innerHTML = ['all', ...brands].map(key => {
            const on = current === key;
            return `<button type="button" data-brand="${escHtml(key)}" class="px-5 py-2 rounded-full text-sm font-black transition-colors ${on ? 'bg-[#f2a7b5] text-white' : 'bg-white text-gray-500 border border-[#f2a7b5]/30 hover:text-[#f2a7b5]'}">${key === 'all' ? '全部品牌' : escHtml(key)}</button>`;
        }).join('');
        filters.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
            current = btn.dataset.brand; expanded = false; draw();
        }));

        if (current === 'all') {
            container.className = 'grid grid-cols-1 md:grid-cols-2 gap-8';
            renderSpotlightCardsInto(container, 'board');
            return;
        }
        const list = byBrand[current].slice().sort((a, b) => (b.mentions - a.mentions) || (b.composite - a.composite))
            .map(e => ({ ...e, img: findItemImage(siteData, e.subcat, e.brand, e.name) }));
        const shown = expanded ? list : list.slice(0, BOARD_BRAND_PREVIEW);
        container.className = 'grid grid-cols-1 md:grid-cols-2 gap-8';
        container.innerHTML = `<div class="col-span-full text-center text-xs text-gray-400 font-bold">${escHtml(current)}：${list.length} 款討論量足夠的商品，依真實討論則數排序</div>`
            + shown.map(e => spotlightCardHtml(e, 'board')).join('')
            + (list.length > shown.length ? `<div class="col-span-full text-center"><button type="button" id="board-brand-more" class="px-6 py-2 rounded-full text-sm font-black bg-white text-[#f2a7b5] border border-[#f2a7b5]/40 hover:bg-[#f2a7b5] hover:text-white transition-colors">顯示全部 ${list.length} 款 ➔</button></div>` : '');
        const more = document.getElementById('board-brand-more');
        if (more) more.addEventListener('click', () => { expanded = true; draw(); });
    };
    draw();
}

async function renderSpotlightCardsInto(container, mode) {
    const items = await topItemsOverall(4);
    if (items.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-12">評分資料建置中，敬請期待</div>';
        return;
    }
    container.innerHTML = items.map(e => spotlightCardHtml(e, mode)).join('');
}

async function renderSpotlightCards(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const filters = mode === 'board' ? document.getElementById('board-brand-filters') : null;
    if (filters) return renderBoardBrands(container, filters);
    return renderSpotlightCardsInto(container, mode);
}

// review-base.html「底妝精選評比」用：真實 Top5 + 真實指標雷達圖
async function renderSubcatTop5(containerId, subcat) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const [items, siteData] = await Promise.all([topItemsForSubcat(subcat, 5), getSiteData()]);
    if (items.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 text-sm py-12">此分類評分資料建置中，敬請期待</div>';
        return;
    }
    const indicators = siteData?.subcategoryDetails?.[subcat]?.indicators || Object.keys(items[0].indicators || {});
    container.innerHTML = items.map((e, i) => {
        const chartConfig = {
            type: 'radar',
            data: {
                labels: indicators,
                datasets: [{
                    label: `${e.brand} ${e.name}`,
                    data: indicators.map(ind => (e.indicators && e.indicators[ind] != null) ? Math.round((e.indicators[ind] / 5) * 100) : 0),
                    backgroundColor: 'rgba(242,167,181,0.2)', borderColor: '#f2a7b5', pointBackgroundColor: '#f2a7b5', borderWidth: 2
                }]
            },
            options: { legend: { display: false }, scale: { ticks: { min: 0, max: 100, stepSize: 20, display: false }, pointLabels: { fontSize: 12, fontStyle: 'bold' } } }
        };
        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
        const rankBg = i === 0 ? 'bg-[#2d2d2d] text-white' : 'bg-gray-200 text-[#2d2d2d]';
        const href = `item-detail.html?item=${encodeURIComponent(e.name)}&from=review`;
        return `
            <div class="bg-white rounded-[32px] p-10 shadow-sm border border-[#f2a7b5]/10">
                <div class="flex flex-col md:flex-row gap-12 items-center">
                    <div class="w-48 h-48 bg-gray-50 rounded-3xl p-4 shrink-0 relative">
                        <span class="absolute -top-4 -left-4 w-12 h-12 ${rankBg} rounded-full flex items-center justify-center font-black text-xl italic border-4 border-white">${i + 1}</span>
                        <a href="${href}"><img src="${e.img || ''}" class="w-full h-full object-contain" alt="${e.name}"></a>
                    </div>
                    <div class="flex-grow w-full">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-black text-gray-500 uppercase tracking-widest">${e.brand}</span>
                            <span class="text-sm font-black text-[#e05a47]">★ ${e.composite.toFixed(1)}（${e.mentions || 0} 則）</span>
                        </div>
                        <a href="${href}" class="block hover:text-[#f2a7b5] transition-colors"><h2 class="text-2xl font-black mb-6">${e.name}</h2></a>
                        <div class="mt-4 flex justify-start items-center">
                            <div class="w-full max-w-md bg-gray-50 rounded-2xl p-4 border border-gray-100/50 flex justify-center items-center">
                                <img src="${chartUrl}" class="w-full object-contain" style="max-height: 250px;" alt="${e.name}指標雷達圖">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

const battleKey = e => `${e.brand}||${e.name}`;

// 依資料建立分類按鈕，並切到第一個分類
async function initBattle() {
    const track = document.getElementById('battle-tabs');
    if (!track) return;
    const scores = await getScoresData();
    const bySub = {};
    Object.values(scores || {}).forEach(e => {
        if (e.composite != null && e.subcat) (bySub[e.subcat] = bySub[e.subcat] || []).push(e);
    });
    const subs = Object.keys(bySub).filter(s => bySub[s].length >= 2);
    if (subs.length === 0) {
        track.innerHTML = '<div class="text-gray-400 text-sm py-2">評分資料累積中，敬請期待</div>';
        return;
    }
    subs.sort((a, b) => {
        const pa = BATTLE_PINNED.indexOf(a), pb = BATTLE_PINNED.indexOf(b);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
        return bySub[b].length - bySub[a].length;
    });
    track.innerHTML = subs.map(s =>
        `<button type="button" data-subcat="${escHtml(s)}" class="battle-btn shrink-0 whitespace-nowrap px-5 py-2 rounded-full border-2 border-gray-100 text-gray-400 font-bold hover:border-[#f2a7b5] hover:text-[#f2a7b5] transition-all text-sm">${escHtml(s)}</button>`
    ).join('');
    track.querySelectorAll('.battle-btn').forEach(btn => {
        btn.addEventListener('click', () => switchBattle(btn.dataset.subcat, btn));
    });
    switchBattle(subs[0], track.querySelector('.battle-btn'));
}

function scrollBattleTabs(direction) {
    const track = document.getElementById('battle-tabs');
    if (!track) return;
    track.scrollBy({ left: track.clientWidth * 0.6 * direction, behavior: 'smooth' });
}

// 切換分類：預設擂台是該分類分數最高的前兩名，使用者可以再用下拉選單換成任何商品
async function switchBattle(subcat, el) {
    document.querySelectorAll('.battle-btn').forEach(btn => {
        const active = btn === el;
        btn.classList.toggle('border-[#f2a7b5]', active);
        btn.classList.toggle('text-[#f2a7b5]', active);
        btn.classList.toggle('border-gray-100', !active);
        btn.classList.toggle('text-gray-400', !active);
    });

    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    const items = Object.values(scores || {})
        .filter(e => e.subcat === subcat && e.composite != null)
        .sort((a, b) => (b.composite - a.composite) || ((b.mentions || 0) - (a.mentions || 0)))
        .map(e => ({ ...e, img: findItemImage(siteData, subcat, e.brand, e.name) }));

    document.getElementById('battle-title').innerText = BATTLE_TITLES[subcat] || `2026 年度${subcat}評比大對決`;

    if (items.length < 2) {
        document.getElementById('battle-cards-row')?.classList.add('hidden');
        document.getElementById('battle-radar-container').innerHTML = '<p class="text-xs font-bold text-gray-400 py-10">此分類真實評分資料仍在累積中，敬請期待！</p>';
        ['left', 'right'].forEach(side => {
            const panel = document.getElementById(`sentiment-${side}`);
            if (panel) panel.innerHTML = '<p class="text-xs font-bold text-gray-400 text-center py-10">資料累積中</p>';
        });
        return;
    }

    battleState.subcat = subcat;
    battleState.items = items;
    battleState.left = items[0];
    battleState.right = items[1];
    document.getElementById('battle-cards-row')?.classList.remove('hidden');
    renderBattle();
}

function onBattleSelect(side, key) {
    const picked = battleState.items.find(e => battleKey(e) === key);
    if (!picked) return;
    battleState[side] = picked;
    renderBattle();
}

// 依 battleState 的左右商品畫出卡片、好感度面板與雷達圖
function renderBattle() {
    const { subcat, left, right } = battleState;
    if (!left || !right) return;
    const leftCard = document.querySelector('#battle-center .group:first-child');
    const rightCard = document.querySelector('#battle-center .group:last-child');
    [[leftCard, left], [rightCard, right]].forEach(([card, item]) => {
        const img = card.querySelector('img');
        const full = item.img || '';
        const thumb = thumbOf(full);
        img.onerror = null;
        if (thumb !== full) img.onerror = () => { img.onerror = null; img.src = full; };
        img.src = thumb;
        img.alt = `${item.brand} ${item.name}`;
        card.querySelector('p').innerText = `${item.brand} ${item.name}`;
    });
    initSentimentAnalysis('left', left);
    initSentimentAnalysis('right', right);
    updateBattleRadarChart(subcat, left, right);
}

// ===== 殘酷擂台：商品選擇器（縮圖卡片）=====
// 只看品名新手認不出是哪一款，所以改成彈出視窗：每個商品有縮圖、品牌、品名、分數、特點標籤與常見別稱，
// 上方可依品牌篩選。手機是從底部滑出的面板，桌面是置中視窗。
// 彈窗在第一次開啟時才建立並掛在 body 底下（不受外層版面影響），沒有新頁面、沒有網址參數。
const battlePicker = { side: null, brand: '全部', returnFocus: null };

function findSiteItem(siteData, subcategory, brand, name) {
    const items = siteData?.subcategoryDetails?.[subcategory]?.items || [];
    return items.find(it => it.brand === brand && it.name === name) || null;
}

function ensureBattlePicker() {
    if (document.getElementById('battle-picker')) return;
    const el = document.createElement('div');
    el.id = 'battle-picker';
    el.className = 'fixed inset-0 z-[100] hidden';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'battle-picker-title');
    el.innerHTML = `
        <div class="absolute inset-0 bg-black/40" data-close="1"></div>
        <div class="absolute inset-x-0 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full md:w-[min(58rem,92vw)] max-h-[88vh] flex flex-col bg-white rounded-t-[28px] md:rounded-[28px] shadow-2xl text-left">
            <div class="shrink-0 flex items-center justify-between gap-3 px-5 md:px-7 pt-5 pb-3">
                <div>
                    <h3 id="battle-picker-title" class="font-black text-lg md:text-xl"></h3>
                    <p id="battle-picker-sub" class="text-xs text-gray-400 font-bold mt-1"></p>
                </div>
                <button type="button" id="battle-picker-close" data-close="1" aria-label="關閉" class="shrink-0 w-9 h-9 rounded-full bg-gray-100 hover:bg-[#f2a7b5] hover:text-white text-gray-500 font-black transition-colors">&#10005;</button>
            </div>
            <div id="battle-picker-brands" class="ranking-tabs shrink-0 flex gap-2 overflow-x-auto px-5 md:px-7 pb-3"></div>
            <div id="battle-picker-grid" class="min-h-0 overflow-y-auto overscroll-contain px-5 md:px-7 pb-6 grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4"></div>
        </div>`;
    document.body.appendChild(el);

    el.addEventListener('click', ev => {
        if (ev.target.closest('[data-close]')) { closeBattlePicker(); return; }
        const chip = ev.target.closest('[data-brand]');
        if (chip) { battlePicker.brand = chip.dataset.brand; renderBattlePicker(); return; }
        const card = ev.target.closest('[data-key]');
        if (card && card.getAttribute('aria-disabled') !== 'true') {
            const side = battlePicker.side;
            closeBattlePicker();
            onBattleSelect(side, card.dataset.key);
        }
    });
    // Esc 關閉；Tab 只在彈窗內循環（不會跑到背後的頁面）
    document.addEventListener('keydown', ev => {
        if (el.classList.contains('hidden')) return;
        if (ev.key === 'Escape') { closeBattlePicker(); return; }
        if (ev.key !== 'Tab') return;
        const f = [...el.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')].filter(b => b.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
}

function openBattlePicker(side) {
    if (!battleState.items.length) return;
    ensureBattlePicker();
    battlePicker.side = side;
    battlePicker.brand = '全部';
    battlePicker.returnFocus = document.getElementById(`battle-pick-${side}`);
    renderBattlePicker();
    document.getElementById('battle-picker').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('battle-picker-close').focus();
}

function closeBattlePicker() {
    const el = document.getElementById('battle-picker');
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    document.body.style.overflow = '';
    if (battlePicker.returnFocus) battlePicker.returnFocus.focus();
}

function renderBattlePicker() {
    const { side, brand } = battlePicker;
    const mine = battleState[side];
    const other = battleState[side === 'left' ? 'right' : 'left'];
    const all = battleState.items;
    const sideName = side === 'left' ? '左側' : '右側';
    document.getElementById('battle-picker-title').textContent = `選擇${sideName}商品・${battleState.subcat}`;
    document.getElementById('battle-picker-sub').textContent = `共 ${all.length} 款有真實評分的商品，依分數排序；點一下就會換成它`;

    // 品牌篩選鈕（依該分類商品數由多到少）
    const counts = {};
    all.forEach(e => { counts[e.brand] = (counts[e.brand] || 0) + 1; });
    const brands = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    const chip = (label, count, active) => `<button type="button" data-brand="${escHtml(label)}" aria-pressed="${active}" class="shrink-0 whitespace-nowrap px-4 py-1.5 rounded-full border-2 text-xs md:text-sm font-bold transition-all ${active ? 'border-[#f2a7b5] text-[#f2a7b5]' : 'border-gray-100 text-gray-400 hover:border-[#f2a7b5] hover:text-[#f2a7b5]'}">${escHtml(label)}${count ? ` ${count}` : ''}</button>`;
    document.getElementById('battle-picker-brands').innerHTML =
        chip('全部', all.length, brand === '全部') + brands.map(b => chip(b, counts[b], brand === b)).join('');

    const siteData = siteDataCache;
    const list = all.filter(e => brand === '全部' || e.brand === brand);
    document.getElementById('battle-picker-grid').innerHTML = list.map(e => {
        const key = battleKey(e);
        const isMine = mine && key === battleKey(mine);
        const isOther = other && key === battleKey(other);
        const site = findSiteItem(siteData, e.subcat, e.brand, e.name) || {};
        const tags = (site.hashtags || []).slice(0, 3);
        const aka = (site.aka || []).slice(0, 2);
        const stateCls = isMine ? 'border-[#f2a7b5] bg-[#fff9f5]' : isOther ? 'border-gray-100 opacity-50 cursor-not-allowed' : 'border-gray-100 hover:border-[#f2a7b5] hover:shadow-md';
        const badge = isMine ? '<span class="absolute top-2 left-2 text-[10px] font-black bg-[#f2a7b5] text-white px-2 py-0.5 rounded-full">目前選擇</span>'
            : isOther ? '<span class="absolute top-2 left-2 text-[10px] font-black bg-gray-400 text-white px-2 py-0.5 rounded-full">已在另一側</span>' : '';
        return `
            <button type="button" data-key="${escHtml(key)}" ${isOther ? 'aria-disabled="true"' : ''} class="relative text-left bg-white border-2 rounded-2xl p-3 flex flex-col gap-1.5 transition-all ${stateCls}">
                ${badge}
                <div class="aspect-square bg-[#fff9f5] rounded-xl p-2 flex items-center justify-center mb-1">
                    <img ${thumbAttrs(e.img)} alt="" loading="lazy" decoding="async" class="max-w-full max-h-full object-contain">
                </div>
                <span class="text-[10px] font-black tracking-widest text-gray-400 uppercase truncate">${escHtml(e.brand)}</span>
                <span class="font-black text-xs md:text-sm leading-snug line-clamp-2 text-[#2d2d2d]">${escHtml(e.name)}</span>
                <span class="text-xs"><span class="text-[#e05a47] font-black">★ ${e.composite.toFixed(1)}</span> <span class="text-gray-400">(${e.mentions || 0}則)</span></span>
                ${aka.length ? `<span class="text-[11px] text-gray-500 leading-snug">常被叫：${escHtml(aka.join('／'))}</span>` : ''}
                ${tags.length ? `<span class="flex flex-wrap gap-1 mt-0.5">${tags.map(t => `<span class="text-[10px] font-bold bg-[#fff0f3] text-[#e6a0ad] px-2 py-0.5 rounded-full">${escHtml(t)}</span>`).join('')}</span>` : ''}
            </button>`;
    }).join('') || '<p class="col-span-full text-center text-sm text-gray-400 py-10">這個品牌在此分類目前沒有評分商品</p>';
}

// 真實社群好感度（依綜合分換算）+ 真實指標強弱項標籤 + 真實代表心得
function initSentimentAnalysis(side, item) {
    const panel = document.getElementById(`sentiment-${side}`);
    if (!panel) return;

    const label = `${item.brand} ${item.name}`;
    const favorability = Math.max(0, Math.min(100, Math.round((item.composite / 5) * 100)));
    const unfavorability = 100 - favorability;

    const entries = Object.entries(item.indicators || {});
    const pros = entries.filter(([, s]) => s >= 3.7).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const cons = entries.filter(([, s]) => s < 3.3).sort((a, b) => a[1] - b[1]).slice(0, 2);

    const chartUrl = `https://quickchart.io/chart?c={type:'pie',data:{labels:['好感度','其餘'],datasets:[{data:[${favorability},${unfavorability}],backgroundColor:['%23f2a7b5','%23eeeeee']}]},options:{legend:{display:false}}}`;

    const quote = item.testimonial ? `<p class="text-xs text-gray-700 italic leading-relaxed px-1">「${item.testimonial.text.slice(0, 60)}${item.testimonial.text.length > 60 ? '…' : ''}」</p>` : '';

    panel.innerHTML = `
        <div class="animate-fade-in flex flex-col gap-4 h-full">
            <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest text-center border-b border-gray-50 pb-2">${label} 好感度</h3>
            <div class="py-4">
                <img src="${chartUrl}" class="sentiment-chart" alt="Sentiment Chart">
                <div class="flex justify-between mt-2 px-2">
                    <span class="text-[10px] font-bold text-[#f2a7b5]">${favorability}% 好感度</span>
                    <span class="text-xs font-black text-[#e05a47]">★ ${item.composite.toFixed(1)}</span>
                </div>
            </div>
            <div>
                <p class="text-[10px] font-black text-gray-500 mb-3 text-center uppercase tracking-tighter">真實指標強弱項</p>
                <div class="tag-cloud">
                    ${pros.map(([name, s]) => `<span class="sentiment-tag tag-pro" style="font-size: ${Math.round(12 + s * 1.4)}px">${name}</span>`).join('')}
                    ${cons.map(([name, s]) => `<span class="sentiment-tag tag-con" style="font-size: ${Math.round(12 + s * 1.4)}px">${name}</span>`).join('')}
                </div>
            </div>
            ${quote}
            <div class="mt-auto pt-4 text-center">
                <p class="text-[9px] text-gray-400 italic">資料來源：Glow Makeup 真實社群評分數據</p>
            </div>
        </div>
    `;
}

// 真實指標雷達圖（0-5 分換算成 0-100，兩側都是真實 AI_Scores 分數）
async function updateBattleRadarChart(subcategory, leftItem, rightItem) {
    const container = document.getElementById('battle-radar-container');
    if (!container) return;

    container.innerHTML = '<div class="spinner"></div>';

    const data = await getSiteData();
    const indicators = data?.subcategoryDetails?.[subcategory]?.indicators || Object.keys(leftItem.indicators || {});
    if (indicators.length === 0) {
        container.innerHTML = '<p class="text-xs font-bold text-gray-400">無法載入指標資料</p>';
        return;
    }

    const toRatings = (item) => indicators.map(ind => {
        const s = item.indicators && item.indicators[ind];
        return s != null ? Math.round((s / 5) * 100) : 0;
    });

    const leftLabel = `${leftItem.brand} ${leftItem.name}`;
    const rightLabel = `${rightItem.brand} ${rightItem.name}`;

    const chartConfig = {
        type: 'radar',
        data: {
            labels: indicators,
            datasets: [
                {
                    label: leftLabel,
                    data: toRatings(leftItem),
                    backgroundColor: 'rgba(242, 167, 181, 0.2)',
                    borderColor: '#f2a7b5',
                    pointBackgroundColor: '#f2a7b5',
                    borderWidth: 2
                },
                {
                    label: rightLabel,
                    data: toRatings(rightItem),
                    backgroundColor: 'rgba(212, 175, 55, 0.2)',
                    borderColor: '#d4af37',
                    pointBackgroundColor: '#d4af37',
                    borderWidth: 2
                }
            ]
        },
        options: {
            legend: {
                labels: {
                    fontSize: 18,
                    fontStyle: 'bold'
                }
            },
            scale: {
                ticks: {
                    min: 0,
                    max: 100,
                    stepSize: 20,
                    display: false
                },
                pointLabels: {
                    fontSize: 22,
                    fontStyle: 'bold'
                }
            }
        }
    };

    const chartUrl = `https://quickchart.io/chart?width=700&height=580&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

    container.innerHTML = `
        <div class="animate-fade-in w-full flex flex-col items-center gap-4">
            <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest text-center border-b border-gray-50 pb-2 w-full">指標效能比較（真實分數）</h3>
            <img src="${chartUrl}" class="w-full object-contain" style="max-height: 380px;" alt="Battle Radar Chart">
        </div>
    `;
}

// 「精選評比」是評分導向的下拉選單，子分類底下如果一個有真實綜合分的品項都沒有，
// 選了也是死路，所以在選單層級就先隱藏（型/分類/子分類三層都是空的就整層拿掉）。
// 「專櫃美妝」則維持完整商品目錄，不受評分進度影響。
async function getScoredSubcats() {
    const scores = await getScoresData();
    if (!scores) return new Set();
    return new Set(Object.values(scores).filter(e => e.composite != null).map(e => e.subcat));
}

function filterTypesByScoredSubcats(types, scoredSubcats) {
    return types
        .map(type => {
            const categories = type.categories
                .map(cat => ({ ...cat, subcategories: cat.subcategories.filter(sub => scoredSubcats.has(sub)) }))
                .filter(cat => cat.subcategories.length > 0);
            return { ...type, categories };
        })
        .filter(type => type.categories.length > 0);
}

// Nav Logic (Mega Menu)
async function initNav() {
    try {
        const [data, scoredSubcats] = await Promise.all([getSiteData(), getScoredSubcats()]);
        if (!data) throw new Error('site-data.json 載入失敗');
        const navContainer = document.getElementById('desktop-nav');
        if (!navContainer) return;

        navContainer.innerHTML = '';

        data.targets.forEach(target => {
            if (!target.hasDropdown) {
                const a = document.createElement('a');
                if (target.name === '最新情報') a.href = 'news.html';
                else if (target.name === '開架美妝') a.href = 'drugstore-beauty.html';
                else if (target.name === '保養專欄') a.href = 'skincare-blog.html';
                else a.href = '#';

                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.textContent = target.name;
                navContainer.appendChild(a);
            } else if (target.tagCategories) {
                // 活動快訊這類「同一個 category、用 tag 細分」的下拉選單：父層連結跟子項目都停在
                // 同一個 category 底下，不會像保養專欄的父層連結那樣導去不分類的全部文章
                const parent = document.createElement('div');
                parent.className = 'dropdown-parent simple-dropdown h-full flex items-center';

                const catParam = encodeURIComponent(target.category);
                const a = document.createElement('a');
                a.href = `skincare-blog.html?category=${catParam}`;
                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.innerHTML = `${target.name} &#x25BE;`;

                const menu = document.createElement('div');
                menu.className = 'dropdown-menu';
                menu.innerHTML = `
                    <a href="skincare-blog.html?category=${catParam}" class="dropdown-item">全部${target.name}</a>
                    ${target.tagCategories.map(tag =>
                        `<a href="skincare-blog.html?category=${catParam}&amp;tag=${encodeURIComponent(tag)}" class="dropdown-item">${tag}</a>`
                    ).join('')}
                `;

                parent.appendChild(a);
                parent.appendChild(menu);
                navContainer.appendChild(parent);
            } else if (target.drugstoreMenu) {
                // 開架美妝：「藥妝開架品牌」（依產地）與「Olive Young」（依品類）兩組簡單下拉
                const parent = document.createElement('div');
                parent.className = 'dropdown-parent simple-dropdown h-full flex items-center';

                const a = document.createElement('a');
                a.href = 'drugstore-beauty.html';
                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.innerHTML = `${target.name} &#x25BE;`;

                const menu = document.createElement('div');
                menu.className = 'dropdown-menu';
                menu.innerHTML = `
                    <a href="drugstore-beauty.html" class="dropdown-item">全部開架美妝</a>
                    ${target.drugstoreMenu.map(g => `
                        <a href="drugstore-beauty.html?group=${g.group}" class="dropdown-item" style="color:var(--primary);font-weight:800">${g.name}</a>
                        ${g.sections.map(sec => `<a href="drugstore-beauty.html?section=${encodeURIComponent(sec)}" class="dropdown-item" style="padding-left:40px;font-weight:600">${sec}</a>`).join('')}
                    `).join('')}
                `;

                parent.appendChild(a);
                parent.appendChild(menu);
                navContainer.appendChild(parent);
            } else if (target.articleCategories) {
                // 保養專欄：簡單 3 項分類下拉（保養/清潔/化妝），跟商品目錄的大型 mega-menu 分開處理
                const parent = document.createElement('div');
                parent.className = 'dropdown-parent simple-dropdown h-full flex items-center';

                const a = document.createElement('a');
                a.href = 'skincare-blog.html';
                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.innerHTML = `${target.name} &#x25BE;`;

                const menu = document.createElement('div');
                menu.className = 'dropdown-menu';
                menu.innerHTML = `
                    <a href="skincare-blog.html" class="dropdown-item">全部文章</a>
                    ${target.articleCategories.map(cat =>
                        `<a href="skincare-blog.html?category=${encodeURIComponent(cat)}" class="dropdown-item">${cat}</a>`
                    ).join('')}
                `;

                parent.appendChild(a);
                parent.appendChild(menu);
                navContainer.appendChild(parent);
            } else {
                const parent = document.createElement('div');
                parent.className = 'dropdown-parent h-full flex items-center';

                const a = document.createElement('a');
                if (target.name === '專櫃美妝') a.href = 'board-landing.html';
                else if (target.name === '精選評比') a.href = 'review-landing.html';
                else a.href = '#';

                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.innerHTML = `${target.name} &#x25BE;`;

                const megaMenu = document.createElement('div');
                megaMenu.className = 'mega-menu';
                
                const inner = document.createElement('div');
                inner.className = 'mega-menu-inner';
                
                const typesContainer = document.createElement('div');
                typesContainer.className = 'mega-types';
                
                const contentContainer = document.createElement('div');
                contentContainer.className = 'mega-content';
                
                let fromContext = 'board';
                if (target.name === '專櫃美妝') fromContext = 'board';
                else if (target.name === '精選評比') fromContext = 'review';

                const menuTypes = fromContext === 'review'
                    ? filterTypesByScoredSubcats(target.types, scoredSubcats)
                    : target.types;

                menuTypes.forEach((type, index) => {
                    const typeEl = document.createElement('div');
                    typeEl.className = 'mega-type-item';
                    typeEl.textContent = type.name;
                    
                    if (index === 0) typeEl.classList.add('active');
                    
                    typeEl.addEventListener('mouseenter', () => {
                        typesContainer.querySelectorAll('.mega-type-item').forEach(el => el.classList.remove('active'));
                        typeEl.classList.add('active');
                        renderCategories(type.categories, contentContainer, fromContext);
                    });
                    
                    typesContainer.appendChild(typeEl);
                    
                    if (index === 0) {
                        renderCategories(type.categories, contentContainer, fromContext);
                    }
                });
                
                inner.appendChild(typesContainer);
                inner.appendChild(contentContainer);
                megaMenu.appendChild(inner);
                
                parent.appendChild(a);
                parent.appendChild(megaMenu);
                navContainer.appendChild(parent);
            }
        });

        renderMobileNav(data, scoredSubcats);
    } catch(err) {
        console.error('Error loading nav:', err);
    }
}

// 手機版選單：同一份 site-data.json，改成手風琴式展開（沒有滑鼠 hover，下拉選單全部改點擊展開）
function renderMobileNav(data, scoredSubcats) {
    const list = document.getElementById('mobile-nav-list');
    if (!list) return;

    list.innerHTML = '';

    data.targets.forEach(target => {
        if (!target.hasDropdown) {
            const a = document.createElement('a');
            if (target.name === '最新情報') a.href = 'news.html';
            else if (target.name === '開架美妝') a.href = 'drugstore-beauty.html';
            else if (target.name === '保養專欄') a.href = 'skincare-blog.html';
            else a.href = '#';
            a.className = 'mobile-nav-link';
            a.textContent = target.name;
            list.appendChild(a);
            return;
        }

        const parent = document.createElement('div');
        parent.className = 'mobile-nav-parent';
        parent.innerHTML = `<span>${target.name}</span><span class="mobile-nav-caret">&#x25BE;</span>`;

        const submenu = document.createElement('div');
        submenu.className = 'mobile-nav-submenu';

        if (target.tagCategories) {
            const catParam = encodeURIComponent(target.category);
            submenu.innerHTML = `
                <a href="skincare-blog.html?category=${catParam}" class="mobile-nav-sub-item">全部${target.name}</a>
                ${target.tagCategories.map(tag =>
                    `<a href="skincare-blog.html?category=${catParam}&amp;tag=${encodeURIComponent(tag)}" class="mobile-nav-sub-item">${tag}</a>`
                ).join('')}
            `;
        } else if (target.drugstoreMenu) {
            submenu.innerHTML = `
                <a href="drugstore-beauty.html" class="mobile-nav-sub-item">全部開架美妝</a>
                ${target.drugstoreMenu.map(g => `
                    <a href="drugstore-beauty.html?group=${g.group}" class="mobile-nav-type-label" style="display:block">${g.name}</a>
                    ${g.sections.map(sec => `<a href="drugstore-beauty.html?section=${encodeURIComponent(sec)}" class="mobile-nav-sub-item">${sec}</a>`).join('')}
                `).join('')}
            `;
        } else if (target.articleCategories) {
            submenu.innerHTML = `
                <a href="skincare-blog.html" class="mobile-nav-sub-item">全部文章</a>
                ${target.articleCategories.map(cat =>
                    `<a href="skincare-blog.html?category=${encodeURIComponent(cat)}" class="mobile-nav-sub-item">${cat}</a>`
                ).join('')}
            `;
        } else {
            let fromContext = target.name === '精選評比' ? 'review' : 'board';
            const menuTypes = fromContext === 'review'
                ? filterTypesByScoredSubcats(target.types, scoredSubcats)
                : target.types;

            menuTypes.forEach(type => {
                const typeLabel = document.createElement('div');
                typeLabel.className = 'mobile-nav-type-label';
                typeLabel.textContent = type.name;
                submenu.appendChild(typeLabel);

                type.categories.forEach(cat => {
                    const catLabel = document.createElement('div');
                    catLabel.className = 'mobile-nav-cat-label';
                    catLabel.textContent = cat.name;
                    submenu.appendChild(catLabel);

                    cat.subcategories.forEach(sub => {
                        const subEl = document.createElement('a');
                        subEl.href = `detail.html?sub=${encodeURIComponent(sub)}&from=${fromContext}`;
                        subEl.className = 'mobile-nav-sub-item';
                        subEl.textContent = sub;
                        submenu.appendChild(subEl);
                    });
                });
            });
        }

        parent.addEventListener('click', () => {
            const isOpen = parent.classList.toggle('expanded');
            submenu.classList.toggle('expanded', isOpen);
        });

        list.appendChild(parent);
        list.appendChild(submenu);
    });
}

// 手機版選單開關（漢堡按鈕 / 遮罩 / ESC 都能關閉，開啟時鎖住背景捲動）
function initMobileMenuToggle() {
    const toggleBtn = document.getElementById('mobileMenuToggle');
    const closeBtn = document.getElementById('mobileMenuClose');
    const overlay = document.getElementById('mobileNavOverlay');
    const nav = document.getElementById('mobileNav');
    if (!toggleBtn || !overlay || !nav) return;

    function openMenu() {
        overlay.classList.add('open');
        nav.classList.add('open');
        nav.setAttribute('aria-hidden', 'false');
        toggleBtn.setAttribute('aria-expanded', 'true');
        document.body.classList.add('mobile-nav-open');
    }

    function closeMenu() {
        overlay.classList.remove('open');
        nav.classList.remove('open');
        nav.setAttribute('aria-hidden', 'true');
        toggleBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('mobile-nav-open');
    }

    toggleBtn.addEventListener('click', openMenu);
    closeBtn?.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });
}

function renderCategories(categories, container, fromContext) {
    container.innerHTML = '';
    categories.forEach(cat => {
        const catCol = document.createElement('div');
        catCol.className = 'mega-category';
        
        const title = document.createElement('div');
        title.className = 'mega-category-title';
        title.textContent = cat.name;
        catCol.appendChild(title);
        
        cat.subcategories.forEach(sub => {
            const subEl = document.createElement('a');
            subEl.href = `detail.html?sub=${encodeURIComponent(sub)}&from=${fromContext}`;
            subEl.className = 'mega-subcategory block';
            subEl.textContent = sub;
            catCol.appendChild(subEl);
        });
        
        container.appendChild(catCol);
    });
}

// Initial Load
window.addEventListener('DOMContentLoaded', () => {
    initNav();
    initSearch();
    initMobileMenuToggle();
    initSlider();
    initRankings();
    initHomeQuizVisibility();
    renderMarquee();
    renderNewProducts();
    renderLatestArticlesSection();
    renderSkincareArticles();
    renderWeeklyNews();
    renderNewsNewProducts();
    renderNewsVoices();
    renderDrugstore();
    renderSpotlightCards('board-spotlight-grid', 'board');
    renderSpotlightCards('review-spotlight-grid', 'review');
    renderSubcatTop5('subcat-top5-grid', '粉底液');
    if (document.getElementById('sentiment-left')) {
        initBattle();
    }
});

/* ===== 站內搜尋 =====
   搜尋框原本全站 10 個頁面都有，但沒有綁任何程式碼，輸入完全沒反應（安全政策卻已
   寫明「僅在你的瀏覽器內即時比對站內既有的商品與文章資料」）。這裡補上實作：純前端
   比對已經載入的 site-data.json 與 articles.json，不送出任何請求。 */
const SEARCH_MAX_ITEMS = 6;
const SEARCH_MAX_ARTICLES = 4;
let searchIndexCache = null;

// 比對用正規化：忽略大小寫、空白與常見分隔符，讓「bobbi brown」「BobbiBrown」都能命中
function normalizeSearchText(s) {
    return (s || '').toString().toLowerCase().replace(/[\s\-_.·・／/]/g, '');
}

async function buildSearchIndex() {
    if (searchIndexCache) return searchIndexCache;
    const [siteData, articles] = await Promise.all([getSiteData(), getArticles()]);
    const items = [];
    if (siteData && siteData.subcategoryDetails) {
        Object.entries(siteData.subcategoryDetails).forEach(([subcat, detail]) => {
            (detail.items || []).forEach(it => {
                items.push({
                    type: 'item',
                    name: it.name, brand: it.brand, subcat,
                    image: it.image,
                    url: `item-detail.html?item=${encodeURIComponent(it.name)}&from=board`,
                    hay: normalizeSearchText(`${it.brand} ${it.name} ${subcat} ${(it.hashtags || []).join(' ')}`),
                });
            });
        });
    }
    const arts = (articles || []).map(a => ({
        type: 'article',
        name: a.title, brand: a.category || '保養專欄', subcat: a.tag || '',
        image: a.image,
        url: `article.html?id=${encodeURIComponent(a.id)}`,
        hay: normalizeSearchText(`${a.title} ${a.category} ${a.tag} ${(a.concerns || []).join(' ')} ${a.excerpt}`),
    }));
    searchIndexCache = { items, articles: arts };
    return searchIndexCache;
}

function searchRank(entry, q) {
    const i = entry.hay.indexOf(q);
    if (i < 0) return -1;
    return i === 0 ? 0 : 1;          // 開頭命中優先
}

function renderSearchResults(panel, q, hits) {
    if (!q) { panel.classList.remove('is-open'); panel.innerHTML = ''; return; }
    const { items, articles } = hits;
    if (!items.length && !articles.length) {
        panel.innerHTML = `<p class="search-empty">找不到「${q}」相關的商品或文章</p>`;
        panel.classList.add('is-open');
        return;
    }
    const row = (e) => `
        <a href="${e.url}" class="search-result" role="option">
            <img src="${e.image || 'assets/placeholder.png'}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <span class="search-result-text">
                <span class="search-result-name">${e.name}</span>
                <span class="search-result-meta">${[e.brand, e.subcat].filter(Boolean).join(' · ')}</span>
            </span>
        </a>`;
    panel.innerHTML =
        (items.length ? `<p class="search-group">商品</p>${items.map(row).join('')}` : '') +
        (articles.length ? `<p class="search-group">文章</p>${articles.map(row).join('')}` : '');
    panel.classList.add('is-open');
}

function initSearch() {
    document.querySelectorAll('.search-container').forEach(container => {
        const input = container.querySelector('.search-input');
        if (!input || container.dataset.searchReady) return;
        container.dataset.searchReady = '1';

        const panel = document.createElement('div');
        panel.className = 'search-results';
        panel.setAttribute('role', 'listbox');
        container.appendChild(panel);

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');

        let timer = null;
        let active = -1;

        const rows = () => Array.from(panel.querySelectorAll('.search-result'));
        const setActive = (n) => {
            const list = rows();
            if (!list.length) return;
            active = (n + list.length) % list.length;
            list.forEach((el, i) => el.classList.toggle('is-active', i === active));
            list[active].scrollIntoView({ block: 'nearest' });
        };
        const close = () => {
            panel.classList.remove('is-open');
            input.setAttribute('aria-expanded', 'false');
            active = -1;
        };

        const run = async () => {
            const q = normalizeSearchText(input.value);
            if (q.length < 1) { close(); return; }
            const idx = await buildSearchIndex();
            const pick = (arr, max) => arr
                .map(e => ({ e, r: searchRank(e, q) }))
                .filter(x => x.r >= 0)
                .sort((a, b) => a.r - b.r)
                .slice(0, max)
                .map(x => x.e);
            active = -1;
            renderSearchResults(panel, input.value.trim(), {
                items: pick(idx.items, SEARCH_MAX_ITEMS),
                articles: pick(idx.articles, SEARCH_MAX_ARTICLES),
            });
            input.setAttribute('aria-expanded', panel.classList.contains('is-open') ? 'true' : 'false');
        };

        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(run, 120);
        });
        input.addEventListener('focus', () => { if (input.value.trim()) run(); });
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { close(); input.blur(); return; }
            const list = rows();
            if (!list.length) return;
            if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(active + 1); }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(active - 1); }
            else if (ev.key === 'Enter' && active >= 0) { ev.preventDefault(); list[active].click(); }
        });
        document.addEventListener('click', (ev) => {
            if (!container.contains(ev.target)) close();
        });
    });
}
