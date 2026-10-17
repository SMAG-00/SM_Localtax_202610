"""벤치마킹 누락 검사 (PRD-00 4.5).

PRD-00 4장의 BM-/RP- 반영표와 PRD-01~05·PRD-X 요구사항 표의 근거 칸이
서로 빠짐없이 맞는지 검사한다. 하나라도 어기면 종료 코드 1.

사용: python docs/tools/check_benchmark_coverage.py [PRD 폴더]
"""

import re
import sys
from pathlib import Path

ITEM_ID = re.compile(r"\b(BM-[SALWCT]\d{1,2}|RP-\d{2})\b")
# 요구사항 ID: 대문자로 시작하는 접두어(숫자 포함 가능, 예: REG1) + 두 자리 번호
FR_ID = re.compile(r"\b(?!PRD-|BM-|RP-)([A-Z][A-Z0-9]{1,5}-\d{2})\b")
# 단계 PRD + 후속 선택 과제(관광성 상품 후보)
STAGE_FILES = [f"PRD-0{n}" for n in range(1, 6)] + ["PRD-X"]


def cells(line: str) -> list[str]:
    """표 한 줄 → 칸 목록. 백슬래시로 이스케이프한 세로선은 칸 구분이 아니다."""
    return [c.strip() for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def section(text: str, start: str, end: str) -> str:
    """start 제목 줄부터 end 제목 줄 전까지."""
    i = text.index(start)
    j = text.index(end, i)
    return text[i:j]


def parse_mapping(prd00: str):
    """4.2·4.3 반영표 → {ID: (반영, 요구사항 칸, FR 목록)}"""
    body = section(prd00, "### 4.2", "### 4.4")
    items = {}
    for line in body.splitlines():
        m = re.match(r"^\| (BM-[SALWCT]\d{1,2}|RP-\d{2}) \|", line)
        if not m:
            continue
        c = cells(line)
        if len(c) != 5:
            raise SystemExit(f"반영표 칸 수가 5가 아님: {line[:60]}")
        item_id, _content, _where, kind, req = c
        if item_id in items:
            raise SystemExit(f"반영표 ID 중복: {item_id}")
        items[item_id] = (kind, req, FR_ID.findall(req))
    return items


def parse_changes(prd00: str) -> set[str]:
    """4.4 의도적으로 바꾼 것 — 첫 칸의 항목 ID."""
    body = section(prd00, "### 4.4", "### 4.5")
    ids = set()
    for line in body.splitlines():
        if line.startswith("| ") and not line.startswith("|---"):
            ids.update(ITEM_ID.findall(cells(line)[0]))
    return ids


def parse_stage(path: Path):
    """요구사항 표 (| ID | 요구사항 | 우선 | 근거 | 수용 기준 |) → {FR: 근거 ID 목록}"""
    frs = {}
    bad = []
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = re.match(r"^\| ((?!BM-|RP-|PRD-)[A-Z][A-Z0-9]{1,5}-\d{2}) \|", line)
        if not m:
            continue
        c = cells(line)
        if len(c) != 5 or not re.fullmatch(r"P[0-2]", c[2]):
            bad.append(f"{path.name}:{no} 요구사항 표 형식 아님 (칸 {len(c)}개)")
            continue
        frs[m.group(1)] = (ITEM_ID.findall(c[3]), f"{path.name}:{no}")
    return frs, bad


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    prd_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "PRD"
    prd00 = next(prd_dir.glob("PRD-00*.md")).read_text(encoding="utf-8")
    items = parse_mapping(prd00)
    changed = parse_changes(prd00)

    frs: dict[str, tuple[list[str], str]] = {}
    errors: list[str] = []
    for stem in STAGE_FILES:
        # 한 단계가 여러 문서로 나뉠 수 있다 (예: PRD-01A·01B·01C) — 접두어가 맞는 파일을 모두 읽는다
        found = sorted(prd_dir.glob(f"{stem}*.md"))
        if not found:
            errors.append(f"{stem} 파일 없음")
            continue
        for path in found:
            stage_frs, bad = parse_stage(path)
            errors.extend(bad)
            for fr, val in stage_frs.items():
                if fr in frs:
                    errors.append(f"요구사항 ID 중복: {fr} ({frs[fr][1]} · {val[1]})")
                frs[fr] = val

    # 1~3. 반영표 → 요구사항 (있음 · 정의됨 · 근거 칸 일치)
    for item_id, (kind, req, mapped) in items.items():
        if kind == "문서":
            if "PRD-00" not in req:
                errors.append(f"{item_id}: '문서' 항목에 반영 위치(PRD-00 장)가 없음")
            continue
        if kind == "제품 밖":
            if "기획안" not in req:
                errors.append(f"{item_id}: '제품 밖' 항목에 기획안 이관 표시가 없음")
            continue
        if kind not in ("그대로", "변형"):
            errors.append(f"{item_id}: 반영 값이 그대로·변형·문서·제품 밖이 아님 ({kind})")
        if not mapped:
            errors.append(f"{item_id}: 연결된 요구사항이 없음")
        for fr in mapped:
            if fr not in frs:
                errors.append(f"{item_id}: 요구사항 {fr}가 단계 PRD에 없음")
            elif item_id not in frs[fr][0]:
                errors.append(f"{item_id}: {fr}({frs[fr][1]})의 근거 칸에 {item_id}가 없음")
        # 6. 변형은 4.4에 이유
        if kind == "변형" and item_id not in changed:
            errors.append(f"{item_id}: '변형'인데 4.4에 이유가 없음")

    # 4. 근거 칸의 ID는 4장에 있고, 반영표도 그 요구사항을 가리킨다
    for fr, (refs, where) in frs.items():
        for ref in refs:
            if ref not in items:
                errors.append(f"{where} {fr}: 근거 {ref}가 PRD-00 4장에 없음")
            elif fr not in items[ref][2]:
                errors.append(f"{where} {fr}: 근거 {ref}의 반영표 요구사항 칸에 {fr}가 없음")

    counts = {
        "벤치마킹(BM)": sum(1 for i in items if i.startswith("BM-")),
        "기타 기획(RP)": sum(1 for i in items if i.startswith("RP-")),
        "요구사항(FR)": len(frs),
        "근거가 있는 FR": sum(1 for v in frs.values() if v[0]),
    }
    print(" · ".join(f"{k} {v}" for k, v in counts.items()))
    if errors:
        print(f"실패 {len(errors)}건")
        for e in errors:
            print(" -", e)
        return 1
    print("통과 — 모든 BM·RP 항목이 요구사항에 연결되고, 근거 칸과 양방향으로 일치한다")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
