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
async function getArticles() {
    if (articlesCache) return articlesCache;
    try {
        const res = await fetch('articles.json?v=34');
        const data = await res.json();
        articlesCache = (data.articles || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return articlesCache;
    } catch (err) {
        console.error('articles.json 載入失敗', err);
        articlesCache = [];
        return articlesCache;
    }
}

function formatArticleDate(d) {
    return (d || '').replace(/-/g, '.');
}

async function initSlider() {
    const track = document.getElementById('mainSlider');
    if (!track) return;

    const articles = (await getArticles()).slice(0, MAX_SLIDES);
    if (articles.length === 0) {
        track.innerHTML = '<div class="slide shrink-0 flex items-center justify-center bg-[#fdeef1]"><p class="font-black text-[#e6a0ad]">保養專欄尚無文章</p></div>';
        return;
    }

    track.innerHTML = articles.map((a, i) => `
        <a href="${a.url || 'skincare-blog.html'}" class="slide shrink-0 block" style="background-image: linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url('${a.image}')">
            <div class="absolute inset-0 flex items-center justify-center text-center px-4">
                <div class="max-w-4xl">
                    <span class="${SLIDE_TAG_COLORS[i % SLIDE_TAG_COLORS.length]} text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-widest mb-4 inline-block">保養專欄${a.tag ? ' · #' + a.tag : ''}</span>
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

// 首頁「最新文章」卡片：真實 articles.json 最新 3 篇（取代原本連去錯誤頁面的樣板文章）
async function renderLatestArticlesSection() {
    const grid = document.getElementById('latest-articles-grid');
    if (!grid) return;
    const articles = (await getArticles()).slice(0, 3);
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
            <h4 class="text-xl font-black mb-4 leading-tight group-hover:text-[#f2a7b5] transition-colors cursor-pointer" onclick="location.href='${a.url || 'skincare-blog.html'}'">${a.title}</h4>
        </div>
    `).join('');
}

// 保養專欄分類/標籤篩選狀態。category: undefined=尚未從網址初始化, null=全部文章；tag: null=不篩選標籤
window.blogFilterState = { category: undefined, tag: null };

// 保養專欄列表（與首頁輪播同一份 articles.json，確保「輪播＝專欄最新文章」不會不同步）
// news.html 也共用這個 function，但沒有 category-tabs/tag-filters 容器，會自動略過分類/標籤篩選只顯示全部文章
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
        renderCategoryTabs(allArticles, tabsContainer);
        if (window.blogFilterState.category) {
            filtered = filtered.filter(a => a.category === window.blogFilterState.category);
        }
    }

    if (tagContainer) {
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
                <h3 class="text-2xl font-black mt-2 mb-4">${a.title}</h3>
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

window.setBlogTag = function (tag) {
    // 再點一次同一個標籤 = 取消篩選
    window.blogFilterState.tag = (window.blogFilterState.tag === tag) ? null : tag;
    renderSkincareArticles();
};

// 首頁 Top 5 熱門榜單（真實綜合分，需評論量足夠）
const RANKING_MIN_MENTIONS = 20;

async function initRankings() {
    const grid = document.getElementById('rankings-grid');
    if (!grid) return;

    const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
    if (!scores) {
        grid.innerHTML = '<div class="text-gray-400 text-sm">無法載入評分資料</div>';
        return;
    }

    const ranked = Object.values(scores)
        .filter(e => e.composite != null && (e.mentions || 0) >= RANKING_MIN_MENTIONS)
        .sort((a, b) => (b.composite - a.composite) || (b.mentions - a.mentions))
        .slice(0, 5);

    if (ranked.length === 0) {
        grid.innerHTML = '<div class="text-gray-400 text-sm">評分資料累積中，敬請期待</div>';
        return;
    }

    grid.innerHTML = ranked.map((e, i) => {
        const img = findItemImage(siteData, e.subcat, e.brand, e.name);
        const pct = Math.round((e.composite / 5) * 100);
        const rankBg = i === 0 ? 'bg-[#2d2d2d] text-white' : 'bg-gray-200 text-[#2d2d2d]';
        return `
            <a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=board" class="flex items-center gap-6 bg-white p-8 rounded-3xl border border-[#f2a7b5]/5 shadow-sm hover:shadow-md hover:border-[#f2a7b5]/30 transition-all group">
                <div class="w-12 h-12 ${rankBg} rounded-full flex items-center justify-center font-black text-xl shrink-0 italic">${i + 1}</div>
                <div class="w-24 h-24 bg-gray-50 rounded-2xl p-2 shrink-0 overflow-hidden">
                    <img src="${img}" class="w-full h-full object-contain group-hover:scale-105 transition-transform" alt="${e.name}">
                </div>
                <div class="flex-grow min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-black text-[#f2a7b5] bg-[#f2a7b5]/10 px-2 py-0.5 rounded-full">${e.subcat}</span>
                        <span class="text-xs font-bold text-gray-500">${e.mentions} 則提及</span>
                    </div>
                    <h4 class="font-black text-lg mb-1 truncate group-hover:text-[#f2a7b5] transition-colors" title="${e.name}">${e.name}</h4>
                    <p class="text-sm font-black text-gray-500 uppercase tracking-wide mb-3">${e.brand}</p>
                    <div class="flex items-center gap-3">
                        <div class="flex-grow h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div class="bg-[#f2a7b5] h-full" style="width: ${pct}%"></div>
                        </div>
                        <span class="text-sm font-black text-[#e05a47] shrink-0">★ ${e.composite.toFixed(1)}</span>
                    </div>
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
// 底妝品項 hashtags（site-data.json）裡實際會出現的膚質標籤，用來判斷第三題要不要問膚質、
// 以及依膚質篩選品項；只挑這幾個明確的膚質詞，避免跟「控油」「不卡紋」等其他屬性標籤混在一起
const SKIN_TYPE_TAGS = ['油肌', '乾肌', '混合肌', '中性肌', '敏感肌'];

const HOME_QUIZ_CONFIG = {
    '缺乏保養知識': {
        question: '妳最想了解哪個保養主題？',
        options: ['保養', '清潔', '化妝'],
        async hasData(value) {
            const articles = await getArticles();
            return articles.some(a => a.category === value);
        },
        // 第三題：該分類底下的文章標籤夠多元（≥2 個不同標籤）才追問，避免選項只有1個近似重複的假選擇
        async step3(value) {
            const articles = await getArticles();
            const tags = [...new Set(articles.filter(a => a.category === value).map(a => a.tag).filter(Boolean))];
            if (tags.length < 2) return null;
            return { question: '妳想更深入了解哪個主題？', options: tags };
        },
        async buildResult(value, tag) {
            const articles = await getArticles();
            let matched = articles.filter(a => a.category === value);
            if (tag) matched = matched.filter(a => a.tag === tag);
            matched = matched.slice(0, 2);
            const list = matched.length
                ? matched.map(a => `<a href="${a.url}" class="text-[#f2a7b5] font-bold block mt-2">${a.title} ➔</a>`).join('')
                : '<p class="text-gray-400 text-sm mt-2">此主題文章準備中</p>';
            const label = tag || value;
            const categoryParam = encodeURIComponent(value);
            return {
                title: `為妳推薦：「${label}」主題文章`,
                html: `${list}<br><a href="skincare-blog.html?category=${categoryParam}" class="text-[#f2a7b5] font-bold">查看全部「${value}」文章 ➔</a>`
            };
        }
    },
    '挑選底妝困難': {
        question: '妳想找哪種底妝？',
        options: ['粉底液', '氣墊粉餅', '遮瑕膏', '妝前乳'],
        async hasData(value) {
            return (await topItemsForSubcat(value, 1)).length > 0;
        },
        // 第三題：該子分類底下的品項若涵蓋 ≥2 種真實膚質標籤（來自 site-data.json 的
        // item.hashtags，不是憑感覺編的選項），才追問膚質，幫忙篩到更貼合的品項
        async step3(value) {
            const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
            if (!scores) return null;
            const items = Object.values(scores).filter(e => e.subcat === value && e.composite != null);
            const present = new Set();
            items.forEach(e => {
                findItemHashtags(siteData, value, e.brand, e.name).forEach(tag => {
                    if (SKIN_TYPE_TAGS.includes(tag)) present.add(tag);
                });
            });
            if (present.size < 2) return null;
            return { question: '妳的膚質是？', options: SKIN_TYPE_TAGS.filter(t => present.has(t)) };
        },
        async buildResult(value, skinType) {
            const [scores, siteData] = await Promise.all([getScoresData(), getSiteData()]);
            let candidates = scores ? Object.values(scores).filter(e => e.subcat === value && e.composite != null) : [];
            if (skinType) {
                candidates = candidates.filter(e => findItemHashtags(siteData, value, e.brand, e.name).includes(skinType));
            }
            candidates.sort((a, b) => b.composite - a.composite);
            const items = candidates.slice(0, 2).map(e => ({ ...e, img: findItemImage(siteData, value, e.brand, e.name) }));
            const list = items.length
                ? items.map(e => `<a href="item-detail.html?item=${encodeURIComponent(e.name)}&from=board" class="text-[#f2a7b5] font-bold block mt-2">${e.brand} ${e.name}（★${e.composite.toFixed(1)}）➔</a>`).join('')
                : '<p class="text-gray-400 text-sm mt-2">此分類評分資料建置中</p>';
            const label = skinType ? `${skinType}適用「${value}」` : `社群高分「${value}」`;
            return { title: `為妳推薦：${label}`, html: `依真實社群評分，這幾款最受好評：${list}` };
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

function nextStep(current) {
    const currentStep = document.querySelector(`.quiz-step[data-step="${current}"]`);
    const selected = currentStep.querySelector('.option-card.selected');

    if (!selected) {
        alert('請選擇一個選項！');
        return;
    }

    if (current === 1) {
        const category = selected.querySelector('h4').innerText;
        renderQuizStep2(category);
        currentStep.classList.add('hidden');
        return;
    }

    if (current === 2) {
        const category = document.querySelector('.quiz-step[data-step="1"] .option-card.selected h4').innerText;
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
        const category = document.querySelector('.quiz-step[data-step="1"] .option-card.selected h4').innerText;
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
                <h4 class="font-bold text-lg">${opt}</h4>
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
            <h4 class="font-bold text-lg">${opt}</h4>
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
        const category = card.querySelector('h4').innerText;
        const config = HOME_QUIZ_CONFIG[category];
        if (!config) return;
        const availability = await Promise.all(config.options.map(opt => config.hasData(opt)));
        if (!availability.some(Boolean)) card.classList.add('hidden');
    }));
}

// 5. Cruel Battle 殘酷擂台（真實資料版：composite/indicators/testimonial 全部來自 scores-data.json）

const battleData = {
    'makeup': { title: '2026 年度持妝粉底爭霸戰', subcategory: '粉底液' },
    'skincare': { title: '2026 年度防曬力巔峰對決', subcategory: '防曬乳' },
    'blush': { title: '2026 年度腮紅顯色大戰', subcategory: '腮紅' }
};

let siteDataCache = null;
let scoresDataCache = null;

async function getSiteData() {
    if (siteDataCache) return siteDataCache;
    try {
        const response = await fetch('site-data.json?v=31');
        siteDataCache = await response.json();
        return siteDataCache;
    } catch (err) {
        console.error('Error fetching site data:', err);
        return null;
    }
}

async function getScoresData() {
    if (scoresDataCache) return scoresDataCache;
    try {
        const response = await fetch('scores-data.json?v=31');
        scoresDataCache = await response.json();
        return scoresDataCache;
    } catch (err) {
        console.error('Error fetching scores data:', err);
        return null;
    }
}

// 找該品項在 site-data.json 裡的圖片（scores-data 本身不存圖）
function findItemImage(siteData, subcategory, brand, name) {
    const items = siteData?.subcategoryDetails?.[subcategory]?.items || [];
    const found = items.find(it => it.brand === brand && it.name === name);
    return (found && (found.image || found.img)) || '';
}

function findItemHashtags(siteData, subcategory, brand, name) {
    const items = siteData?.subcategoryDetails?.[subcategory]?.items || [];
    const found = items.find(it => it.brand === brand && it.name === name);
    return (found && found.hashtags) || [];
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

// 美妝看板／精選評比 landing 頁用：真實 Top 商品卡片（board=討論則數、review=綜合評分）
async function renderSpotlightCards(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const items = await topItemsOverall(4);
    if (items.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-12">評分資料建置中，敬請期待</div>';
        return;
    }
    container.innerHTML = items.map(e => {
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
                    <img src="${e.img || ''}" alt="${e.brand}" class="max-w-full max-h-[160px] object-contain group-hover:scale-105 transition-transform duration-500">
                </div>
                <div class="flex flex-col justify-between py-2">
                    <div>
                        <div class="flex justify-between items-center gap-2 mb-2">
                            <span class="text-xs font-black tracking-widest text-gray-500 uppercase">${e.brand}</span>
                            ${badge}
                        </div>
                        <h3 class="font-black text-xl text-[#2d2d2d] group-hover:text-[#f2a7b5] transition-colors mb-2">${e.name}</h3>
                        <p class="text-xs text-gray-500 leading-relaxed line-clamp-3">${quote}</p>
                    </div>
                    <span class="text-xs font-bold text-[#f2a7b5] mt-4 flex items-center gap-1 group-hover:translate-x-1 transition-transform">${cta}</span>
                </div>
            </a>
        `;
    }).join('');
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
                        <a href="${href}" class="block hover:text-[#f2a7b5] transition-colors"><h3 class="text-2xl font-black mb-6">${e.name}</h3></a>
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

async function switchBattle(category, el) {
    const conf = battleData[category];
    if (!conf) return;

    // Update Button States
    document.querySelectorAll('.battle-btn').forEach(btn => {
        btn.classList.remove('border-[#f2a7b5]', 'text-[#f2a7b5]');
        btn.classList.add('border-gray-100', 'text-gray-400');
    });
    if (el) {
        el.classList.remove('border-gray-100', 'text-gray-400');
        el.classList.add('border-[#f2a7b5]', 'text-[#f2a7b5]');
    }

    document.getElementById('battle-title').innerText = conf.title;

    const top2 = await topTwoForSubcat(conf.subcategory);
    if (top2.length < 2) {
        document.getElementById('battle-center').querySelector('.flex.justify-between.items-center.mb-12')?.classList.add('hidden');
        document.getElementById('battle-radar-container').innerHTML = '<p class="text-xs font-bold text-gray-400 py-10">此分類真實評分資料仍在累積中，敬請期待！</p>';
        ['left', 'right'].forEach(side => {
            const panel = document.getElementById(`sentiment-${side}`);
            if (panel) panel.innerHTML = '<p class="text-xs font-bold text-gray-400 text-center py-10">資料累積中</p>';
        });
        return;
    }

    const [leftItem, rightItem] = top2;
    document.getElementById('battle-center').querySelector('.flex.justify-between.items-center.mb-12')?.classList.remove('hidden');

    const leftCard = document.querySelector('#battle-center .group:first-child');
    const rightCard = document.querySelector('#battle-center .group:last-child');

    leftCard.querySelector('img').src = leftItem.img || '';
    leftCard.querySelector('p').innerText = `${leftItem.brand} ${leftItem.name}`;

    rightCard.querySelector('img').src = rightItem.img || '';
    rightCard.querySelector('p').innerText = `${rightItem.brand} ${rightItem.name}`;

    initSentimentAnalysis('left', leftItem);
    initSentimentAnalysis('right', rightItem);
    updateBattleRadarChart(conf.subcategory, leftItem, rightItem);
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
            <h4 class="text-xs font-black text-gray-500 uppercase tracking-widest text-center border-b border-gray-50 pb-2">${label} 好感度</h4>
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
                    ${pros.map(([name, s]) => `<span class="sentiment-tag tag-pro" style="font-size: ${Math.round(s * 7)}px">${name}</span>`).join('')}
                    ${cons.map(([name, s]) => `<span class="sentiment-tag tag-con" style="font-size: ${Math.round(s * 7)}px">${name}</span>`).join('')}
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
                    fontSize: 15,
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
                    fontSize: 16,
                    fontStyle: 'bold'
                }
            }
        }
    };

    const chartUrl = `https://quickchart.io/chart?width=560&height=460&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;

    container.innerHTML = `
        <div class="animate-fade-in w-full flex flex-col items-center gap-4">
            <h4 class="text-xs font-black text-gray-500 uppercase tracking-widest text-center border-b border-gray-50 pb-2 w-full">指標效能比較（真實分數）</h4>
            <img src="${chartUrl}" class="w-full object-contain" style="max-height: 380px;" alt="Battle Radar Chart">
        </div>
    `;
}

// 「精選評比」是評分導向的下拉選單，子分類底下如果一個有真實綜合分的品項都沒有，
// 選了也是死路，所以在選單層級就先隱藏（型/分類/子分類三層都是空的就整層拿掉）。
// 「美妝看板」則維持完整商品目錄，不受評分進度影響。
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
        const [response, scoredSubcats] = await Promise.all([fetch('site-data.json?v=31'), getScoredSubcats()]);
        const data = await response.json();
        const navContainer = document.getElementById('desktop-nav');
        if (!navContainer) return;

        navContainer.innerHTML = '';

        data.targets.forEach(target => {
            if (!target.hasDropdown) {
                const a = document.createElement('a');
                if (target.name === '最新情報') a.href = 'news.html';
                else if (target.name === '保養專欄') a.href = 'skincare-blog.html';
                else a.href = '#';

                a.className = 'nav-link hover:text-[#f2a7b5] h-full flex items-center';
                a.textContent = target.name;
                navContainer.appendChild(a);
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
                if (target.name === '美妝看板') a.href = 'board-landing.html';
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
                if (target.name === '美妝看板') fromContext = 'board';
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
    } catch(err) {
        console.error('Error loading nav:', err);
    }
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
    initSlider();
    initRankings();
    initHomeQuizVisibility();
    renderMarquee();
    renderLatestArticlesSection();
    renderSkincareArticles();
    renderSpotlightCards('board-spotlight-grid', 'board');
    renderSpotlightCards('review-spotlight-grid', 'review');
    renderSubcatTop5('subcat-top5-grid', '粉底液');
    if (document.getElementById('sentiment-left')) {
        const firstBtn = document.querySelector('.battle-btn');
        switchBattle('makeup', firstBtn);
    }
});
