# -*- coding: utf-8 -*-
"""PRD md → 탭형 파스텔 HTML (html-pastel-style 변환기·CSS를 그대로 쓰고 탭만 덧붙인다).

usage: python build_prd_tabs.py input.md output.html [source-label]
  - 첫 '# H1' → 표지, 다음 문단 → 표지 아랫줄
  - '## N. 제목' 하나 = 탭 하나(파스텔 카드). 넓은 화면은 왼쪽 세로 탭, 좁은 화면은 위쪽 가로 탭
  - JS가 없으면 모든 장이 차례로 보인다. 인쇄하면 탭과 상관없이 모든 장이 나온다
"""
import html, os, re, sys
from datetime import date

SKILL = os.path.join(os.path.expanduser("~"), ".claude", "skills", "html-pastel-style")
sys.path.insert(0, os.path.join(SKILL, "scripts"))
import build_html as bh  # noqa: E402

TAB_CSS = r"""
/* ============ TABS (PRD 탭형 덧붙임) ============ */
.page.page--tabs{ max-width:1240px; }
.cover-meta{ margin-top:16px; }
.cm{ background:#fff; border:1px solid var(--navy-bd); border-radius:10px; padding:9px 12px; display:flex; flex-direction:column; gap:2px; }
.cm-k{ font-size:11.5px; font-weight:700; color:var(--muted); letter-spacing:.04em; }
.cm-v{ font-size:14px; font-weight:800; color:var(--navy); word-break:keep-all; overflow-wrap:anywhere; }
.sync-badge{ margin-top:12px; font-size:13px; color:var(--muted); }
.tabs-layout{ margin-top:18px; }
.tabnav{ position:sticky; top:0; z-index:5; background:rgba(255,255,255,.94); backdrop-filter:blur(6px);
  border-bottom:1px solid var(--line); margin:0 calc(-1 * clamp(26px,5vw,60px)); padding:10px clamp(26px,5vw,60px); }
.tabnav-tools{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; }
.tabnav-title{ font-size:12px; font-weight:800; letter-spacing:.12em; color:var(--muted); }
.allbtn{ font:inherit; font-size:12.5px; font-weight:700; color:var(--navy); background:var(--navy-bg);
  border:1px solid var(--navy-bd); border-radius:999px; padding:5px 12px; cursor:pointer; min-height:32px; }
.allbtn[aria-pressed="true"]{ background:var(--navy); color:#fff; border-color:var(--navy); }
.tablist{ display:flex; gap:6px; overflow-x:auto; scrollbar-width:thin; position:relative; padding-bottom:2px; }
.tab{ --t-ac:var(--accent); --t-bg:var(--accent-soft); --t-dp:var(--accent-ink);
  font:inherit; display:flex; align-items:center; gap:8px; flex:0 0 auto; cursor:pointer; text-align:left;
  background:transparent; border:1px solid transparent; border-radius:10px; padding:7px 11px; min-height:40px;
  color:var(--text); font-size:14px; font-weight:600; line-height:1.35; white-space:nowrap; }
.tab:hover{ background:var(--bg); }
.tab:focus-visible,.allbtn:focus-visible,.pager button:focus-visible{ outline:2px solid var(--t-ac,var(--accent)); outline-offset:2px; }
.tab-no{ flex:0 0 auto; min-width:26px; text-align:center; font-size:11.5px; font-weight:800; color:var(--t-dp);
  background:var(--t-bg); border:1px solid color-mix(in srgb, var(--t-ac) 30%, transparent); border-radius:6px; padding:2px 6px; }
.tab[aria-selected="true"]{ background:var(--t-bg); border-color:color-mix(in srgb, var(--t-ac) 45%, transparent); color:var(--t-dp); font-weight:800; }
.tab[aria-selected="true"] .tab-no{ background:var(--t-ac); color:#fff; border-color:var(--t-ac); }
.tab--sky{ --t-ac:var(--sky-ac); --t-bg:var(--sky-bg); --t-dp:var(--sky-dp); }
.tab--orange{ --t-ac:var(--orange-ac); --t-bg:var(--orange-bg); --t-dp:var(--orange-dp); }
.tab--violet{ --t-ac:var(--violet-ac); --t-bg:var(--violet-bg); --t-dp:var(--violet-dp); }
.tab--amber{ --t-ac:var(--amber-ac); --t-bg:var(--amber-bg); --t-dp:var(--amber-dp); }
.tab--mint{ --t-ac:var(--mint-ac); --t-bg:var(--mint-bg); --t-dp:var(--mint-dp); }
h2.sess-title{ font-size:clamp(19px,2.6vw,22px); color:var(--ink); margin:6px 0 4px; padding:0; border:0; line-height:1.3; }
h2.sess-title::before{ display:none; }
.panels > .card:first-child{ margin-top:14px; }
.panels > .card{ scroll-margin-top:120px; }
.panels > .card:focus{ outline:none; }
.panels > .card:focus-visible{ outline:2px solid var(--c-ac); outline-offset:3px; }
.tbl-wrap td,.tbl-wrap th{ word-break:keep-all; overflow-wrap:anywhere; }
.embed-ph{ display:flex; gap:10px; align-items:baseline; margin:12px 0 16px; padding:10px 14px; border:1px dashed var(--c-bd);
  border-radius:12px; background:rgba(255,255,255,.55); color:var(--muted); font-size:14px; }
.embed-ph span{ flex:0 0 auto; font-size:11.5px; font-weight:800; color:var(--c-dp); background:#fff; border:1px solid var(--c-bd);
  border-radius:6px; padding:1px 7px; }
.pager{ display:flex; justify-content:space-between; gap:10px; margin-top:22px; padding-top:14px; border-top:1px dashed var(--c-bd); }
.pager button{ font:inherit; font-size:13.5px; font-weight:700; color:var(--c-dp); background:rgba(255,255,255,.75);
  border:1px solid var(--c-bd); border-radius:10px; padding:8px 13px; cursor:pointer; min-height:40px; max-width:48%; text-align:left; }
.pager button:hover{ background:#fff; }
.pager .next{ margin-left:auto; text-align:right; }
.pager small{ display:block; font-size:11.5px; font-weight:600; color:var(--muted); }
html:not(.js) .tabnav, html:not(.js) .pager{ display:none; }
.doc-foot{ margin-top:26px; font-size:12.5px; color:var(--muted); text-align:center; }
@media (min-width:1100px){
  .tabs-layout{ display:grid; grid-template-columns:250px minmax(0,1fr); gap:26px; align-items:start; }
  .tabnav{ top:16px; margin:14px 0 0; padding:12px 10px; border:1px solid var(--line); border-radius:14px;
    max-height:calc(100vh - 32px); overflow:auto; background:#fff; box-shadow:var(--shadow-sm); }
  .tabnav-tools{ flex-direction:column; align-items:stretch; padding:0 4px; }
  .tablist{ flex-direction:column; overflow:visible; }
  .tab{ white-space:normal; width:100%; }
}
@media (max-width:680px){
  .tabnav{ margin:0 -12px; padding:8px 12px; }
  .cover{ padding:22px 18px; }
  .pager button{ font-size:13px; }
}
@media print{
  .tabnav,.pager{ display:none !important; }
  .panels > .card{ display:block !important; }
  .tabs-layout{ display:block; }
}
"""

TAB_JS = r"""
(function(){
  var root=document.documentElement; root.classList.add('js');
  var tabs=[].slice.call(document.querySelectorAll('.tab')), panels=[].slice.call(document.querySelectorAll('.panels > .card'));
  var list=document.querySelector('.tablist'), allBtn=document.querySelector('.allbtn'), layout=document.querySelector('.tabs-layout');
  var showAll=false;
  function idx(id){ for(var i=0;i<panels.length;i++){ if(panels[i].id===id) return i; } return -1; }
  function keepTabVisible(t){
    if(list.scrollWidth>list.clientWidth){ list.scrollTo({left:t.offsetLeft-list.clientWidth/2+t.offsetWidth/2}); }
    else if(t.offsetParent){ var n=t.closest('.tabnav'); if(n.scrollHeight>n.clientHeight){ n.scrollTop=t.offsetTop-n.clientHeight/2; } }
  }
  function toTop(){ var top=layout.getBoundingClientRect().top+window.scrollY-8; if(window.scrollY>top) window.scrollTo(0,top); }
  function select(i,opts){
    opts=opts||{};
    tabs.forEach(function(t,k){ var on=k===i; t.setAttribute('aria-selected',on?'true':'false'); t.tabIndex=on?0:-1; });
    keepTabVisible(tabs[i]); if(opts.focus) tabs[i].focus();
    if(showAll){ panels[i].scrollIntoView({block:'start'}); }
    else { panels.forEach(function(p,k){ p.hidden=k!==i; }); if(opts.scroll!==false) toTop(); }
    if(opts.hash!==false && location.hash!=='#'+panels[i].id) history.replaceState(null,'','#'+panels[i].id);
  }
  function setAll(on){
    showAll=on; allBtn.setAttribute('aria-pressed',on?'true':'false');
    allBtn.textContent=on?'한 장씩 보기':'모든 장 펼치기';
    var cur=tabs.findIndex(function(t){return t.getAttribute('aria-selected')==='true';});
    if(on){ panels.forEach(function(p){ p.hidden=false; }); }
    else { select(cur<0?0:cur); }
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){ select(i); });
    t.addEventListener('keydown',function(e){
      var n=null;
      if(e.key==='ArrowRight'||e.key==='ArrowDown') n=(i+1)%tabs.length;
      else if(e.key==='ArrowLeft'||e.key==='ArrowUp') n=(i-1+tabs.length)%tabs.length;
      else if(e.key==='Home') n=0; else if(e.key==='End') n=tabs.length-1;
      if(n!==null){ e.preventDefault(); select(n,{focus:true}); }
    });
  });
  document.querySelectorAll('.pager button').forEach(function(b){
    b.addEventListener('click',function(){ var i=idx(b.getAttribute('data-go')); if(showAll) setAll(false); select(i,{focus:true}); });
  });
  allBtn.addEventListener('click',function(){ setAll(!showAll); });
  window.addEventListener('hashchange',function(){ var i=idx(location.hash.slice(1)); if(i>=0) select(i); });
  window.addEventListener('beforeprint',function(){ panels.forEach(function(p){ p.dataset.wasHidden=p.hidden?'1':''; p.hidden=false; }); });
  window.addEventListener('afterprint',function(){ if(!showAll) panels.forEach(function(p){ p.hidden=p.dataset.wasHidden==='1'; }); });
  var start=idx(location.hash.slice(1)); select(start<0?0:start,{scroll:false,hash:false});
})();
"""


def build(md_path, out_path, source_label):
    md_text = open(md_path, encoding="utf-8").read()
    # 노션 내보내기의 '\~'(물결 이스케이프)는 python-markdown이 풀지 않는다 — 범위 표기 '01~06'으로 되돌린다
    md_text = md_text.replace("\\~", "~")
    body = bh._md_body(md_text)
    body = bh._callouts(body)
    # 노션 그림이 있던 자리 — md에는 설명만 남아 있다
    body = re.sub(r"<p>(?:&#91;|\[)embedded content:\s*(.*?)\]</p>",
                  lambda m: f'<p class="embed-ph"><span>그림 자리</span>{m.group(1).strip()}</p>', body)
    body = re.sub(r"<li>\s*\[ \]\s*", '<li class="check">', body)
    body = re.sub(r"<li>\s*\[[xX]\]\s*", '<li class="check checked">', body)
    body = body.replace("<table>", '<div class="tbl-wrap"><table>').replace("</table>", "</table></div>")

    m = re.search(r"<h1[^>]*>(.*?)</h1>", body, flags=re.S)
    title = re.sub(r"<.*?>", "", m.group(1)).strip()
    body = body[m.end():]
    lm = re.match(r"\s*<p>(.*?)</p>", body, flags=re.S)
    lede = lm.group(1).strip() if lm else ""
    if lm:
        body = body[lm.end():]

    parts = re.split(r"(<h2[^>]*>.*?</h2>)", body, flags=re.S)
    intro = parts[0].strip()
    chapters = []
    for k in range(1, len(parts), 2):
        text = html.unescape(re.sub(r"<.*?>", "", parts[k])).strip()
        nm = re.match(r"(\d+)\.\s*(.+)", text)
        no, name = (nm.group(1), nm.group(2)) if nm else (str(len(chapters)), text)
        chapters.append({"no": no, "name": name, "short": name.split(" — ")[0], "html": parts[k + 1]})

    fams = [f.replace("card--", "") for f in bh.FAMILIES]
    tabs, panels = [], []
    for i, c in enumerate(chapters):
        fam = fams[i % len(fams)]
        pid = f"ch{c['no']}"
        tabs.append(
            f'<button type="button" role="tab" class="tab tab--{fam}" id="tab-{pid}" aria-controls="{pid}" aria-selected="false" tabindex="-1">'
            f'<span class="tab-no">{c["no"]}</span><span class="tab-label">{html.escape(c["short"])}</span></button>')
        pager = []
        if i > 0:
            p = chapters[i - 1]
            pager.append(f'<button type="button" class="prev" data-go="ch{p["no"]}"><small>← 이전 장</small>{p["no"]}장 {html.escape(p["short"])}</button>')
        if i < len(chapters) - 1:
            n = chapters[i + 1]
            pager.append(f'<button type="button" class="next" data-go="ch{n["no"]}"><small>다음 장 →</small>{n["no"]}장 {html.escape(n["short"])}</button>')
        panels.append(
            f'<section class="card card--{fam}" role="tabpanel" id="{pid}" aria-labelledby="tab-{pid}" tabindex="0">'
            f'<div class="sess-head"><span class="sess-no">{c["no"]}장</span>'
            f'<h2 class="sess-title">{html.escape(c["name"])}</h2></div>{c["html"]}'
            f'<nav class="pager" aria-label="장 이동">{"".join(pager)}</nav></section>')

    today = date.today().isoformat()
    meta = [("판", "v2.1 정리본"), ("장", f"{len(chapters)}개 ({chapters[0]['no']}~{chapters[-1]['no']}장)"),
            ("원본", source_label), ("만든 날", today)]
    cover = ('<header class="cover"><div class="eyebrow">PRD · 최상위 기준 문서</div>'
             f"<h1>{title}</h1>" + (f'<p class="cover-lede">{lede}</p>' if lede else "") +
             '<div class="cover-meta">' + "".join(f'<div class="cm"><span class="cm-k">{k}</span><span class="cm-v">{html.escape(v)}</span></div>' for k, v in meta) +
             '</div><div class="sync-badge">읽기용 사본입니다. 내용이 다르면 원본 md가 맞습니다.</div></header>')

    css = open(bh.CSS, encoding="utf-8").read()
    head = ("<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1'>"
            f"<title>{html.escape(title)}</title>"
            "<link rel='preconnect' href='https://cdn.jsdelivr.net' crossorigin>"
            f"<link rel='stylesheet' href='{bh.PRETENDARD}'>"
            f"<style>{css}{TAB_CSS}</style></head><body><div class='page page--tabs'><div class='doc'>")
    nav = ('<nav class="tabnav" aria-label="PRD 장 목록"><div class="tabnav-tools"><span class="tabnav-title">장 목록</span>'
           '<button type="button" class="allbtn" aria-pressed="false">모든 장 펼치기</button></div>'
           f'<div class="tablist" role="tablist" aria-label="PRD 장">{"".join(tabs)}</div></nav>')
    doc = (head + cover + (f'<div class="intro">{intro}</div>' if intro else "") +
           f'<div class="tabs-layout">{nav}<div class="panels">{"".join(panels)}</div></div>'
           f'<p class="doc-foot">원본 {html.escape(source_label)} · {today} 변환 (html-pastel-style 탭형)</p>'
           f"</div></div><script>{TAB_JS}</script></body></html>")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(doc)
    return len(chapters)


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(src)
    print(f"written: {out} ({build(src, out, label)} tabs)")
