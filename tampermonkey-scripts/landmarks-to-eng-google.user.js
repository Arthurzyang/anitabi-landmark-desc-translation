// ==UserScript==
// @name         anitabi - card-translate-by-dom (ZH->EN, footer button)
// @namespace    https://anitabi.cn/
// @description  在地标卡片底部加“Translate to English”，当切换到新地标时复位按钮与译文
// @match        *://anitabi.cn/map*
// @match        *://www.anitabi.cn/map*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      translate.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  const BTN_LABEL_DEFAULT = 'Translate to English';
  const BTN_LABEL_BUSY    = '翻译中...';
  const BTN_LABEL_DONE    = '已翻译';

  GM_addStyle(`
    .anita-footer-bar{display:flex;align-items:center;gap:8px;padding:6px 8px;margin-top:6px;border-top:1px solid rgba(0,0,0,.06);background:rgba(248,249,252,.75);border-radius:8px;}
    .anita-trans-btn{cursor:pointer;user-select:none;border:1px solid rgba(0,0,0,.15);border-radius:6px;padding:6px 10px;font-size:12px;line-height:1;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);}
    .anita-trans-btn:hover{background:#f7f7f7;}
    .anita-trans-result{margin-top:8px;padding:8px;border-radius:6px;background:#f3f6ff;font-size:12px;white-space:pre-wrap;}
  `);

  const CARD_SELECTORS = [
    '.mapboxgl-popup-content','.leaflet-popup-content','.amap-info-content','.gm-style-iw',
    '.popup-card','.poi-card','.info-window','.info-card','.ant-card-body','.ant-popover-inner'
  ].join(',');

  // 根观察器：发现卡片 -> 绑定 + 内层观察
  const rootObserver = new MutationObserver(() => {
    document.querySelectorAll(CARD_SELECTORS).forEach(bindCard);
  });
  rootObserver.observe(document.documentElement, { childList:true, subtree:true });
  requestAnimationFrame(() => document.querySelectorAll(CARD_SELECTORS).forEach(bindCard));

  function bindCard(card){
    if (!card) return;
    if (!card.__anitaInnerObserver){
      const inner = new MutationObserver(() => ensureControls(card, /*dueToChange*/true));
      inner.observe(card, { childList:true, subtree:true, characterData:true });
      card.__anitaInnerObserver = inner;
    }
    ensureControls(card, false);
  }

  function ensureControls(card, dueToChange){
    if (!looksLikePoi(card)) return;

    const footer = ensureFooterBar(card);
    let btn = footer.querySelector('.anita-trans-btn');
    if (!btn){
      btn = document.createElement('button');
      btn.className = 'anita-trans-btn';
      btn.textContent = BTN_LABEL_DEFAULT;
      btn.title = 'Translate description to English';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const src = (extractText(card) || '').trim();
        if (!src){ btn.textContent = '无可翻译文本'; btn.disabled = false; return; }
        btn.disabled = true; btn.textContent = BTN_LABEL_BUSY;

        try{
          const en = await translateToEn(src);
          showResult(card, en);
          btn.textContent = BTN_LABEL_DONE;
          // 记录这次内容的“指纹”
          card.__anitaLastSrc = src;
        }catch(err){
          console.error('[anitabi-translate] error:', err);
          btn.disabled = false; btn.textContent = '失败，点重试';
          setTimeout(()=>{ if(!btn.disabled) btn.textContent = BTN_LABEL_DEFAULT; }, 1800);
        }
      });
      footer.appendChild(btn);
    }

    // —— 内容变化时复位状态 —— //
    const curSrc = (extractText(card) || '').trim();
    if (dueToChange && curSrc !== card.__anitaLastSrc){
      resetUI(card, btn);
      card.__anitaLastSrc = curSrc || undefined; // 仅作为当前内容指纹
    }
  }

  function resetUI(card, btn){
    btn.disabled = false;
    btn.textContent = BTN_LABEL_DEFAULT;
    // 移除旧译文框
    card.querySelectorAll('.anita-trans-result').forEach(n => n.remove());
  }

  function looksLikePoi(card){
    const txt = (card.innerText || '').trim();
    return /学校|站|路|湖|河|桥|公园|广场|寺|神社|商店|咖啡|温泉|景区|车站/.test(txt)
           || card.querySelector('img, h1, h2, h3, .title, .name');
  }

  function ensureFooterBar(card){
    let bar = card.querySelector('.anita-footer-bar');
    if (bar) return bar;
    let anchor = Array.from(card.querySelectorAll('div,section,footer'))
                  .reverse()
                  .find(n => /@\d{2,}|^@/.test((n.innerText||'').trim()))
                || card.lastElementChild || card;
    bar = document.createElement('div');
    bar.className = 'anita-footer-bar';
    anchor.insertAdjacentElement('afterend', bar);
    return bar;
  }

  // —— 只取正文描述段落（更通用的过滤）——
  function pickDescNode(card){
    const nodes = Array.from(card.querySelectorAll(
      '.description, .desc, .poi-desc, .content p, .ant-card-body p, .mapboxgl-popup-content p, p'
    ));
    let best=null, bestScore=0;
    const reCJK = /[\u4E00-\u9FA5\u3040-\u30FF\u3400-\u9FFF]/g;

    for (const el of nodes){
      if (!el || el.closest('a,button') || el.querySelector('a,button')) continue;
      const txt = (el.innerText || '').replace(/\s+/g,' ').trim();
      if (!txt) continue;

      // 忽略明显的元信息/短标签/纯中日短行（常见为作品名/地名）
      if (/^@/.test(txt) || /@\d{2,}/.test(txt)) continue;
      if (txt.length <= 6 && /^[\u4E00-\u9FA5\u3040-\u30FF\u3400-\u9FFF]+$/.test(txt)) continue;

      const cjk = (txt.match(reCJK)||[]).length;
      const ratio = cjk / txt.length;
      if (ratio < 0.25) continue;

      const score = ratio * 100 + Math.min(txt.length, 240) / 2;
      if (score > bestScore){ best = el; bestScore = score; }
    }
    return best;
  }

  function extractText(card){
    const target = pickDescNode(card);
    if (target) return target.innerText.trim();

    const lines = (card.innerText || '').split(/\n+/).map(s=>s.trim());
    const filtered = lines.filter(s =>
      s.length >= 6 &&
      !/^@/.test(s) &&
      !/@\d{2,}/.test(s) &&
      /[\u4E00-\u9FA5\u3040-\u30FF\u3400-\u9FFF]/.test(s) &&
      !(s.length <= 6 && /^[\u4E00-\u9FA5\u3040-\u30FF\u3400-\u9FFF]+$/.test(s))
    );
    return filtered.join('\n');
  }

  function showResult(card, textEn){
    const target = pickDescNode(card) || card;
    let box = target.nextElementSibling &&
              target.nextElementSibling.classList &&
              target.nextElementSibling.classList.contains('anita-trans-result')
              ? target.nextElementSibling : null;
    if (!box){
      box = document.createElement('div');
      box.className = 'anita-trans-result';
      target.insertAdjacentElement('afterend', box);
    }
    box.textContent = textEn;
  }

  function translateToEn(text){
    const url = 'https://translate.googleapis.com/translate_a/single'
              + '?client=gtx&sl=auto&tl=en&dt=t&q=' + encodeURIComponent(text);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try{
            const data = JSON.parse(res.responseText);
            const out = (data?.[0] || []).map(x => x?.[0]).filter(Boolean).join('');
            out ? resolve(out) : reject(new Error('empty_translation'));
          }catch(e){ reject(e); }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
})();
