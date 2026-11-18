#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 파일명: youtube_build.py
"""유튜브 나레이션 검증 + xlsx 생성 (17장). 자기신고 금지: 이 스크립트 결과만 인정한다.
사용법:
  python youtube_build.py 2026-11-01_youtube.md           검증 → 전체 PASS면 md 자수 표기 갱신 + xlsx 생성
  python youtube_build.py 2026-11-01_youtube.md --check   검증만
xlsx는 md와 같은 폴더에 같은 이름으로 만든다. 기존 xlsx는 _bak.xlsx로 옮긴다.
"""
# 출처: docs/editorial-desk/프로젝트지침_v4.md 17-10 (2026-11-01). 지침과 함께 고친다.
import re, sys, shutil
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 고정 문구: 17-3·17-5와 띄어쓰기·문장부호까지 같아야 한다. 바꿀 때는 17-6 순서를 따른다.
INTRO_TAIL = "부동산 뉴스 속 숨겨진 호재와 리스크에 대한 INSIGHT를 찾아보실까요? 구독, 좋아요 누르시고 시작하겠습니다."
OUTRO = "본 내용은 참고용이며, 부동산 시장 상황에 따라 본인 책임하에 신중히 판단하십시오. 실수요와 투자는 항상 꼼꼼히 따져 보십시오. ace2025 내일 뵙겠습니다."

RANGE = {"쇼츠": {"narr": (580, 620), "main": (430, 455)},
         "롱폼": {"narr": (2950, 3050), "main": (2830, 2880)}}
TITLE, DESC, TAGS = (50, 70), (480, 700), (150, 200)
FIELD = {"제목": "title", "나레이션": "narr", "설명": "desc", "태그": "tags"}
LONG_MARKS = ("풀버전", "FULL", "Full")
SHEET, FONT_NAME, FONT_SIZE, HEADER_BG = "쇼츠_롱폼", "Pretendard", 10, "1B5E20"


def parse_md(path):
    """17-7 형식의 md → {"쇼츠": {"title","narr","desc","tags"}, "롱폼": {...}}"""
    text = Path(path).read_text(encoding="utf-8-sig")
    data = {}
    for block in re.split(r"^## ", text, flags=re.M)[1:]:
        head, _, body = block.partition("\n")
        tag = "쇼츠" if head.startswith("쇼츠") else "롱폼" if head.startswith("롱폼") else None
        if tag is None:
            continue
        d = {}
        for sec in re.split(r"^### ", body, flags=re.M)[1:]:
            name, _, content = sec.partition("\n")
            for k, key in FIELD.items():
                if name.strip().startswith(k):
                    d[key] = content.strip()
        data[tag] = d
    return data


def validate(path):
    res = []
    chk = lambda label, n, lo, hi: res.append((label, n, f"{lo}-{hi}", lo <= n <= hi))
    flag = lambda label, ok, detail="-": res.append((label, detail, "-", bool(ok)))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})_youtube\.md$", Path(path).name)
    if not m:
        flag("파일명 YYYY-MM-DD_youtube.md", False, Path(path).name)
        return None, res, None
    y, mo, dd = map(int, m.groups())
    data = parse_md(path)
    missing = [f"{t}.{k}" for t in ("쇼츠", "롱폼") for k in FIELD.values() if not data.get(t, {}).get(k)]
    if missing:
        flag("md 형식(17-7) 누락 항목", False, ",".join(missing))
        return None, res, None
    counts = {}
    for tag in ("쇼츠", "롱폼"):
        d = data[tag]
        n = d["narr"]
        flat = n.replace("\n", "")
        counts[tag] = len(flat)
        lines = [l.strip() for l in n.split("\n") if l.strip()]
        intro, outro = lines[0], lines[-1]
        chk(f"{tag} 제목", len(d["title"]), *TITLE)
        chk(f"{tag} 나레이션 전체", len(flat), *RANGE[tag]["narr"])
        chk(f"{tag} 본문", len(flat) - len(intro) - len(outro), *RANGE[tag]["main"])
        chk(f"{tag} 설명", len(d["desc"]), *DESC)
        chk(f"{tag} 태그", len(d["tags"]), *TAGS)
        flag(f"{tag} 인트로 고정 문구·날짜", intro == f"{mo}월 {dd}일 {INTRO_TAIL}", f"{len(intro)}자")
        flag(f"{tag} 아웃트로 고정 문구", outro == OUTRO, f"{len(outro)}자")
        flag(f"{tag} '경고' 미사용", all("경고" not in d[k] for k in ("title", "narr", "desc")))
        flag(f"{tag} 리스크 표현 순서·횟수", re.findall(r"(첫|두) 번째 리스크", n) == ["첫", "두"])
        flag(f"{tag} 태그 # 미사용", "#" not in d["tags"])
        flag(f"{tag} 태그 끝 ace2025", d["tags"].strip().endswith("ace2025"))
    flag("롱폼 제목 구분 표시(풀버전 등)", any(k in data["롱폼"]["title"] for k in LONG_MARKS))
    flag("쇼츠·롱폼 제목 서로 다름", data["쇼츠"]["title"] != data["롱폼"]["title"])
    return data, res, (f"{y:04d}-{mo:02d}-{dd:02d}", counts)


def write_counts(path, counts):
    lines = Path(path).read_text(encoding="utf-8-sig").split("\n")
    tag = None
    for i, l in enumerate(lines):
        if l.startswith("## "):
            tag = "쇼츠" if l[3:].startswith("쇼츠") else "롱폼" if l[3:].startswith("롱폼") else None
        elif l.startswith("### 나레이션") and tag:
            lines[i] = f"### 나레이션 원고 ({counts[tag]}자)"
    Path(path).write_text("\n".join(lines), encoding="utf-8")


def build_xlsx(data, date_str, out):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    bak = out.with_name(out.stem + "_bak.xlsx")
    if out.exists():
        shutil.move(str(out), str(bak))
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    for col, h in enumerate(["일자", "구분", "제목", "내용", "설명", "태그"], 1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = Font(name=FONT_NAME, size=FONT_SIZE, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=HEADER_BG)
        c.alignment = Alignment(horizontal="center", vertical="center")
    body_font = Font(name=FONT_NAME, size=FONT_SIZE)
    for row, tag, label in ((2, "쇼츠", "쇼츠(통합)"), (3, "롱폼", "롱폼")):
        d = data[tag]
        for col, v in enumerate([date_str, label, d["title"], d["narr"], d["desc"], d["tags"]], 1):
            c = ws.cell(row=row, column=col, value=v)
            c.font = body_font
            c.alignment = Alignment(wrap_text=True, vertical="top",
                                    horizontal="center" if col <= 2 else "left")
    for col, w in enumerate([12, 14, 50, 80, 80, 60], 1):
        ws.column_dimensions[get_column_letter(col)].width = w
    ws.row_dimensions[1].height = 20
    ws.row_dimensions[2].height = ws.row_dimensions[3].height = 140
    ws.freeze_panes = "A2"
    wb.save(out)
    # 저장 게이트: 다시 열어 규격을 확인하고, 어긋나면 새 파일을 지우고 백업을 되돌린다
    wb2 = openpyxl.load_workbook(out)
    ok = wb2.sheetnames == [SHEET]
    if ok:
        ws2 = wb2[SHEET]
        cells = [c for r in ws2.iter_rows(min_row=1, max_row=3, max_col=6) for c in r]
        ok = (all(c.font.name == FONT_NAME and c.font.sz == FONT_SIZE for c in cells)
              and all(ws2.cell(1, k).font.b and str(ws2.cell(1, k).fill.fgColor.rgb).endswith(HEADER_BG)
                      for k in range(1, 7))
              and ws2.freeze_panes == "A2"
              and ws2["B2"].value == "쇼츠(통합)" and ws2["B3"].value == "롱폼"
              and ws2["D2"].value == data["쇼츠"]["narr"] and ws2["D3"].value == data["롱폼"]["narr"])
    if not ok:
        out.unlink()
        if bak.exists():
            shutil.move(str(bak), str(out))
    return ok


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = Path(sys.argv[1])
    data, res, info = validate(path)
    for label, val, rng, ok in res:
        print(f"{'PASS' if ok else 'FAIL':<5} {label} ({val} / 기준 {rng})")
    if not all(r[3] for r in res):
        print("\n결과: FAIL. 위 항목을 고친 뒤 다시 실행한다(xlsx는 만들지 않았다).")
        sys.exit(1)
    if "--check" in sys.argv:
        print("\n결과: 전체 PASS (검증만 실행)")
        return
    date_str, counts = info
    write_counts(path, counts)
    out = path.with_suffix(".xlsx")
    if build_xlsx(data, date_str, out):
        print(f"\n결과: 전체 PASS, xlsx 생성 완료: {out.name}")
    else:
        print("\n결과: 검증은 PASS였으나 xlsx 규격 확인에 실패해 파일을 만들지 않았다.")
        sys.exit(1)


if __name__ == "__main__":
    main()
