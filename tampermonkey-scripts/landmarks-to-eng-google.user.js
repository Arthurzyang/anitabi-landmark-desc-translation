// ==UserScript==
// @name         anitabi-landmark-desc-translation(ZH->EN)
// @namespace    https://anitabi.cn/
// @version      0.4.0
// @description  在 anitabi 地图的地标卡片底部增加“翻译成英文”按钮，仅翻译正文描述段落并就地显示译文
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
    .anita-footer-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-top: 6px;
      border-top: 1px solid rgba(0,0,0,.06);
      background: rgba(248,249,252,.75);
      border-radius: 8px;
    }
    .anita-trans-btn {
      cursor: pointer; user-select: none;
      border: 1px solid rgba(0,0,0,.15); border-radius: 6px;
      padding: 6px 10px; font-size: 12px; line-height: 1;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
    }
    .anita-trans-btn:hover { background: #f7f7f7; }
    .anita-trans-result {
      margin-top: 8px;
      padding: 8px;
      border-radius: 6px;
      background: #f3f6ff;
      font-size: 12px;
      white-space: pre-wrap;
    }
  `);

  // 常见信息窗容器
  const CARD_SELECTORS = [
    '.mapboxgl-popup-content',
    '.leaflet-popup-content',
    '.amap-info-content',
    '.gm-style-iw',
    '.popup-card', '.poi-card', '.info-window', '.info-card',
    '.ant-card-body', '.ant-popover-inner'
  ].join(',');

  const mo = new MutationObserver(() => {
    document.querySelectorAll(CARD_SELECTORS).forEach(enhanceCard);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  function enhanceCard(card) {
    if (!card || card.dataset.anitaTransBound === '1') return;

    // 粗筛
    const txt = (card.innerText || '').trim();
    const looksLikePoi =
      /学校|站|路|湖|河|桥|公园|广场|集|寺|神社|商店|咖啡|温泉/.test(txt) ||
      card.querySelector('img, h1, h2, h3, .title, .name');

    if (!looksLikePoi) return;

    card.dataset.anitaTransBound = '1';

    // 底部工具条
    const footer = ensureFooterBar(card);

    // 防重复
    if (footer.querySelector('.anita-trans-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'anita-trans-btn';
    btn.textContent = '翻译成英文';
    btn.title = 'Translate description to English';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = '翻译中...';
      try {
        const src = extractText(card).trim();
        if (!src) {
          btn.textContent = '无可翻译文本';
          return;
        }
        const en = await translateToEn(src);
        showResult(card, en);
        btn.textContent = '已翻译';
      } catch (err) {
        console.error('[anitabi-translate] error:', err);
        btn.textContent = '失败，点重试';
        btn.disabled = false;
      }
    });

    footer.appendChild(btn);
  }

  //—创建/复用卡片底部工具条
  function ensureFooterBar(card) {
    // 如果卡片末尾已经有一个容器，挂在它后面
    let anchor =
      card.querySelector('.anita-footer-bar') ||
      // 底部信息区
      Array.from(card.querySelectorAll('div, section, footer'))
        .reverse()
        .find(n => /@\d{2,}|^@/.test((n.innerText || '').trim()))
      || card.lastElementChild
      || card;

    // 已存在则返回
    let bar = card.querySelector('.anita-footer-bar');
    if (bar) return bar;

    bar = document.createElement('div');
    bar.className = 'anita-footer-bar';
    anchor.insertAdjacentElement('afterend', bar);
    return bar;
  }

  //文本提取
  function pickDescNode(card) {
    const nodes = Array.from(card.querySelectorAll(
      '.description, .desc, .poi-desc, .content p, .ant-card-body p, .mapboxgl-popup-content p, p'
    ));
    let best = null, bestScore = 0;
    const reCJK = /[\u4E00-\u9FA5]/g;

    for (const el of nodes) {
      if (!el) continue;
      if (el.closest('a,button')) continue;
      if (el.querySelector('a,button')) continue;

      const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;

      // 过滤无关信息
      if (/^@/.test(txt)) continue; 
      if (/@\d{2,}/.test(txt)) continue; 
      if (/^缘之空$/.test(txt)) continue;
      if (txt.length < 8) continue;

      const cjk = (txt.match(reCJK) || []).length;
      const ratio = cjk / txt.length;  
      if (ratio < 0.25) continue;

      const score = ratio * 100 + Math.min(txt.length, 240) / 2;
      if (score > bestScore) { best = el; bestScore = score; }
    }
    return best;
  }

  function extractText(card) {
    const target = pickDescNode(card);
    if (target) return target.innerText.trim();

    const lines = (card.innerText || '').split(/\n+/).map(s => s.trim());
    const filtered = lines.filter(s =>
      s.length >= 6 &&
      !/^@/.test(s) &&
      !/^缘之空$/.test(s) &&
      !/@\d{2,}/.test(s) &&
      /[\u4E00-\u9FA5]/.test(s)
    );
    return filtered.join('\n');
  }

  //把译文插到“描述段落”后面
  function showResult(card, textEn) {
    const target = pickDescNode(card) || card;
    let box = target.nextElementSibling &&
              target.nextElementSibling.classList &&
              target.nextElementSibling.classList.contains('anita-trans-result')
              ? target.nextElementSibling : null;

    if (!box) {
      box = document.createElement('div');
      box.className = 'anita-trans-result';
      target.insertAdjacentElement('afterend', box);
    }
    box.textContent = textEn;
  }

  //翻译
  function translateToEn(text) {
    const url = 'https://translate.googleapis.com/translate_a/single'
      + '?client=gtx&sl=auto&tl=en&dt=t&q=' + encodeURIComponent(text);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText);
            const out = (data?.[0] || []).map(x => x?.[0]).filter(Boolean).join('');
            out ? resolve(out) : reject(new Error('empty_translation'));
          } catch (e) { reject(e); }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
})();
