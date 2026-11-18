#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 파일명: threads_check.py
"""쓰레드 원고 검증 (16장). 자기신고 금지: 이 스크립트 결과만 인정한다.
사용법:
  python threads_check.py 2026-11-01_threads.md           검증만
  python threads_check.py 2026-11-01_threads.md --write   전체 통과면 quality_checks와 '검증:' 줄을 파일에 기록
"""
# 출처: docs/editorial-desk/프로젝트지침_v4.md 16-6 (2026-11-01). 지침과 함께 고친다.
import json, re, sys
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 링크 설정: 0-6 공통 설정값과 같아야 한다. 고정 URL이 정해지면 이 두 값만 바꾼다.
THREADS_CONFIG = {"youtube_url": "TBD", "article_url": "TBD"}
PROMPT_VERSION = "localtax_threads_v1_2026-11-01"
URL_RESERVE = 60   # 링크가 TBD인 동안 나중에 들어올 주소 길이를 60자로 잡고 500자 한도를 계산한다
LIMIT = 500
SECTIONS = ("1)", "2)", "3)", "4)", "5)")
BANNED = ("경고", "무조건", "대폭락", "역대급", "실화냐", "오늘의 뉴스", "같이 알아볼까요")
HAEYO = re.compile(r"(?:어요|아요|해요|에요|예요|래요|대요|줘요|봐요|돼요|워요|와요|네요|군요|거든요|죠)(?=[\s.!?…,]|$)")
QUOTED = re.compile(r"\"[^\"]*\"|“[^”]*”|‘[^’]*’|'[^']*'")
URL_RE = re.compile(r"https?://\S+")
EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿]")
NUM_RE = re.compile(r"\d[\d,.]*\d|\d")
JSON_RE = re.compile(r"`{3}json\s*(\{.*?\})\s*`{3}", re.S)
NAME_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})_threads\.md$")


def link_lines():
    return [f"🎥 자세한 영상: {THREADS_CONFIG['youtube_url']}",
            f"📝 전체 글: {THREADS_CONFIG['article_url']}"]


def lines_of(s):
    return [l.strip() for l in s.split("\n") if l.strip()]


def parse(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    cut = text.find("\n---\n")
    body = text if cut < 0 else text[:cut]
    sec = {}
    for block in re.split(r"^## ", body, flags=re.M)[1:]:
        name, _, content = block.partition("\n")
        for s in SECTIONS:
            if name.strip().startswith(s):
                sec[s] = content.strip()
    m = JSON_RE.search(text, cut if cut >= 0 else len(text))
    return text, sec, m


def talk_lines(sec, links):
    first = lines_of(sec["1)"])[:1]
    talk = [l for l in lines_of(sec["5)"]) if l not in links and not l.startswith("출처")]
    return set(first + talk)


def dup_check(path, sec, links):
    p = Path(path).resolve()
    m = NAME_RE.search(p.name)
    if not m:
        return ("파일명 YYYY-MM-DD_threads.md", "FAIL", p.name)
    today = date(*map(int, m.groups()))
    root = p.parents[2] if len(p.parents) > 2 else p.parent   # New_Article\yyyy_mm_dd\thread\파일
    seen, n = set(), 0
    for f in root.glob("*/thread/*_threads.md"):
        fm = NAME_RE.search(f.name)
        if f.resolve() == p or not fm:
            continue
        if not (today - timedelta(days=7) <= date(*map(int, fm.groups())) <= today):
            continue
        _, s2, _ = parse(f)
        if "1)" in s2 and "5)" in s2:
            seen |= talk_lines(s2, links)
            n += 1
    dup = talk_lines(sec, links) & seen
    detail = f"비교 {n}건" + (f", 중복: {sorted(dup)[0][:20]}" if dup else "")
    return ("최근 7일 첫 문장·대화 문구 중복 없음", "FAIL" if dup else "PASS", detail)


def check(path):
    res = []   # (항목, 결과, 상세)  결과 = PASS / FAIL / HOLD(링크 TBD) / WARN(권장 미달)
    add = lambda label, status, detail="-": res.append((label, status, detail))
    text, sec, m = parse(path)
    missing = [s for s in SECTIONS if s not in sec]
    add("5개 섹션", "FAIL" if missing else "PASS", ",".join(missing) or "-")
    if missing:
        return res, None, text, m
    links = link_lines()
    tbd = [k for k, v in THREADS_CONFIG.items() if v == "TBD"]
    bad = [k for k, v in THREADS_CONFIG.items() if v != "TBD" and not re.fullmatch(r"https://\S+", v)]
    s5 = lines_of(sec["5)"])
    if bad:
        add("링크 설정값", "FAIL", ",".join(bad))
    elif s5[-2:] != links:
        add("5/5 마지막 두 줄 링크", "FAIL", "설정값과 다름")
    else:
        add("5/5 마지막 두 줄 링크", "HOLD" if tbd else "PASS", "TBD: 게시 전 교체" if tbd else "-")
    for s in SECTIONS:
        n = len(sec[s]) + (len(tbd) * (URL_RESERVE - 3) if s == "5)" else 0)
        add(f"{s} 500자 이내", "PASS" if n <= LIMIT else "FAIL", f"{n}자")
    n1 = len(sec["1)"])
    add("1) 훅 45~100자(권장)", "PASS" if 45 <= n1 <= 100 else "WARN", f"{n1}자")
    allt = "\n".join(sec[s] for s in SECTIONS)
    plain = URL_RE.sub("", allt)
    add("자리표시자·[텍스트](URL) 없음", "FAIL" if ("{" in allt or "}" in allt or "](" in allt) else "PASS")
    hits = [w for w in BANNED if w in allt]
    add("금지 표현 없음", "FAIL" if hits else "PASS", ",".join(hits) or "-")
    tags = re.findall(r"(?<![\w/&])#\w+", plain)
    add("본문 # 해시태그 없음", "FAIL" if tags else "PASS", ",".join(tags) or "-")
    hy = HAEYO.findall(QUOTED.sub("", plain))   # 따옴표 안 인용은 제외, -세요·-나요·-까요는 허용
    add("-습니다체 유지(해요체 없음)", "FAIL" if hy else "PASS", ",".join(sorted(set(hy))) or "-")
    emo = len(EMOJI_RE.findall("\n".join(l for l in lines_of(allt) if l not in links)))
    add("이모지 0~2개(링크 줄 제외)", "PASS" if emo <= 2 else "FAIL", f"{emo}개")
    ck = [l for l in sec["4)"].split("\n") if l.strip().startswith("- ")]
    add("4) 체크리스트 2~3개", "PASS" if 2 <= len(ck) <= 3 else "FAIL", f"{len(ck)}개")
    src = [l for l in s5 if l.startswith("출처")]
    add("5) 출처 줄 1개(https 포함)", "PASS" if len(src) == 1 and "https://" in src[0] else "FAIL", f"{len(src)}줄")
    talk = [l for l in s5 if l not in links and not l.startswith("출처")]
    q = sum(URL_RE.sub("", l).count("?") for l in talk)
    add("5) 질문 정확히 1개", "PASS" if q == 1 else "FAIL", f"{q}개")
    try:
        meta = json.loads(m.group(1)) if m else None
    except json.JSONDecodeError as e:
        meta = None
        add("메타데이터 JSON", "FAIL", str(e)[:40])
    if meta is None:
        if not m:
            add("메타데이터 JSON", "FAIL", "json 블록 없음")
        return res, None, text, m
    errs = []
    if meta.get("prompt_version") != PROMPT_VERSION: errs.append("prompt_version")
    if meta.get("category") != "local_tax": errs.append("category")
    if meta.get("hook_type") not in ("A", "B", "C", "D", "E"): errs.append("hook_type")
    if meta.get("link_source") != "user_configured": errs.append("link_source")
    errs += [k for k in THREADS_CONFIG if meta.get(k) != THREADS_CONFIG[k]]
    notes = meta.get("source_notes") or []
    if not notes or not all(x.get("claim") and str(x.get("url", "")).startswith("https://") for x in notes):
        errs.append("source_notes")
    add("메타데이터 필수값", "FAIL" if errs else "PASS", ",".join(errs) or "-")
    claims = " ".join(str(x.get("claim", "")) for x in notes).replace(",", "")
    body14 = URL_RE.sub("", "\n".join(sec[s] for s in SECTIONS[:4]))
    lost = sorted({t.replace(",", "") for t in NUM_RE.findall(body14) if t.replace(",", "") not in claims})
    add("1~4번 숫자 출처 추적", "FAIL" if lost else "PASS", ",".join(lost) or "-")
    add(*dup_check(path, sec, links))
    return res, meta, text, m


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    res, meta, text, m = check(path)
    for label, status, detail in res:
        print(f"{status:<5} {label} ({detail})")
    fails = [r for r in res if r[1] == "FAIL"]
    if fails:
        print(f"\n결과: FAIL {len(fails)}건. 고친 뒤 다시 실행한다(16-6).")
        sys.exit(1)
    hold = any(r[1] == "HOLD" for r in res)
    summary = "전체 PASS" + (" (링크 TBD 보류: 게시 전 교체)" if hold else "")
    print("\n결과: " + summary)
    if "--write" in sys.argv:
        meta["quality_checks"] = {label: status for label, status, _ in res}
        new = text[:m.start(1)] + json.dumps(meta, ensure_ascii=False, indent=2) + text[m.end(1):]
        new = re.sub(r"\n검증:[^\n]*$", "", new.rstrip())
        new += f"\n\n검증: {summary} | threads_check.py | {datetime.now():%Y-%m-%d %H:%M}\n"
        Path(path).write_text(new, encoding="utf-8")
        print("파일에 quality_checks와 '검증:' 줄을 기록했다.")


if __name__ == "__main__":
    main()
