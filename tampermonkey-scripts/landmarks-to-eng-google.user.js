// ==UserScript==
// @name         anitabi - landmark translate - ENG
// @namespace    https://anitabi.cn/
// @version      0.3.0
// @description  给地标卡片加“Translate to ENG”按钮；若注入失败，提供全局悬浮按钮兜底
// @match        *://anitabi.cn/map*
// @match        *://www.anitabi.cn/map*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      translate.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    .anita-trans-btn {
      cursor: pointer; user-select: none;
      border: 1px solid rgba(0,0,0,.15); border-radius: 6px;
      padding: 4px 8px; font-size: 12px; line-height: 1;
      background: #fff; position: absolute; right: 8px; top: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,.12); z-index: 9999;
    }
    .anita-trans-btn:hover { background: #f7f7f7; }
    .anita-trans-result { margin-top: 8px; padding: 8px; border-radius: 6px;
      background: #f3f6ff; font-size: 12px; white-space: pre-wrap; }
    .anita-fab {
      position: fixed; right: 16px; bottom: 16px; z-index: 100000;
      background:#2f88ff; color:#fff; border:none; border-radius:20px;
      padding:10px 14px; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,.18);
      cursor:pointer;
    }
    .anita-fab:hover { filter: brightness(1.05); }
    .anita-toast {
      position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%);
      background: rgba(0,0,0,.75); color: #fff; padding: 8px 12px;
      border-radius: 8px; z-index: 100001; font-size: 12px;
    }
  `);

  // 1) 就地注入按钮 —— 覆盖尽可能多的常见容器
  const CARD_SELECTORS = [
    '.mapboxgl-popup-content',       // Mapbox GL
    '.leaflet-popup-content',        // Leaflet
    '.amap-info-content',            // 高德
    '.gm-style-iw',                  // Google Maps
    '.ant-card, .ant-popover-inner', // AntD
    '.popup-card, .poi-card, .info-window, .info-card'
  ].join(',');

  const mo = new MutationObserver(() => {
    document.querySelectorAll(CARD_SELECTORS).forEach(enhanceCard);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  function enhanceCard(card) {
    if (!card || card.dataset.anitaTransBound === '1') return;
    // 粗略过滤：卡片里有图片/标题/描述
    const hasImg = !!card.querySelector('img');
    const hasTitle = !!card.querySelector('h1,h2,h3,.title,.name');
    const text = card.innerText || '';
    const looksLikePoi = hasImg || hasTitle || /@[\d,]+/.test(text) || /集|学校|公园|道路|湖|河|桥|站/.test(text);
    if (!looksLikePoi) return;

    card.dataset.anitaTransBound = '1';
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';

    if (!card.querySelector('.anita-trans-btn')) {
      const btn = document.createElement('button');
      btn.className = 'anita-trans-btn';
      btn.textContent = 'Translate to ENG';
      btn.addEventListener('click', () => translateCard(card, btn));
      card.appendChild(btn);
      console.log('[anitabi-translate] in-card button injected', card);
    }
  }

  async function translateCard(card, btn) {
    try {
      btn && (btn.disabled = true, btn.textContent = '翻译中...');
      const src = extractText(card).trim();
      if (!src) return toast('Nothing to translate');
      const en = await translateToEn(src);
      showResult(card, en);
      btn && (btn.textContent = 'Translation done');
    } catch (e) {
      console.error(e); toast('Fail to translate. Try again?');
      btn && (btn.textContent = 'Fail', btn.disabled = false);
    }
  }

  function extractText(root) {
    // 优先找描述段落，其次兜底整块文本
    const candidates = [
      '.description', '.desc', '.poi-desc',
      '.content p', '.ant-card-body p',
      'p'
    ];
    for (const sel of candidates) {
      const el = root.querySelector(sel);
      if (el && el.innerText.trim()) return el.innerText;
    }
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.anita-trans-btn,.anita-trans-result').forEach(n => n.remove());
    return (clone.innerText || '').replace(/\s{2,}/g, ' ');
  }

  function showResult(card, textEn) {
    let box = card.querySelector('.anita-trans-result');
    if (!box) {
      box = document.createElement('div');
      box.className = 'anita-trans-result';
      card.appendChild(box);
    }
    box.textContent = textEn;
  }

  function translateToEn(text) {
    const url = 'https://translate.googleapis.com/translate_a/single'
      + '?client=gtx&sl=auto&tl=en&dt=t&q=' + encodeURIComponent(text);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            const out = (data?.[0] || []).map(x => x?.[0]).filter(Boolean).join('');
            out ? resolve(out) : reject(new Error('empty'));
          } catch (e) { reject(e); }
        },
        onerror: reject, ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // 2) 全局悬浮按钮（兜底）
  function ensureFAB() {
    if (document.querySelector('.anita-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'anita-fab';
    fab.textContent = 'Translate card';
    fab.title = 'Click me if cannot find the cards';
    fab.addEventListener('click', async () => {
      // 尝试从主文档里“最像卡片”的区域抓文本
      let target =
        document.querySelector('.mapboxgl-popup-content, .leaflet-popup-content, .amap-info-content, .gm-style-iw, .ant-popover-inner, .ant-card')
        || nearestBigBlock();
      if (!target) return toast('No card desc found');
      await translateCard(target);
    });
    document.body.appendChild(fab);
  }

  // 找到地图区域附近的“最大文字块”作为兜底
  function nearestBigBlock() {
    const map = document.querySelector('#map, .mapboxgl-map, .leaflet-container') || document.body;
    let best = null, bestScore = 0;
    const nodes = Array.from(document.querySelectorAll('div,section,article'));
    for (const n of nodes) {
      const textLen = (n.innerText || '').trim().length;
      if (textLen < 20) continue;
      const rect = n.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 80) continue;
      // 排除导航/脚部
      const cls = (n.className || '') + '';
      if (/header|footer|nav|menu|sidebar/i.test(cls)) continue;
      const score = textLen + rect.width * 0.05 + rect.height * 0.05;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'anita-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // 初始化
  ensureFAB();
  // 偶尔页面是 SPA，延迟再跑一次
  setTimeout(ensureFAB, 1500);
})();
