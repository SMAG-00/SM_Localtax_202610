import { parseLinkRef } from "@/lib/admin/regional-link-rules";
import { actorOf, targetOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadLinkBoard } from "@/lib/server/regional-links/board";
import { runLinkOp } from "@/lib/server/regional-links/ops";

// 지역 연결 관리 (W4 13단계 — PRD-01B REG1-10 · LG-14, docs/dev/W4_설계.md 1장 13단계 · 4장 `/api/admin/regional-links` · 6장 · 12장 100번~).
// 모두 편집 책임자·관리자(PO)만(regional_link.confirm — 기자·감수위원·광고·협찬 담당 등은 403 + 거부 감사).
//  · GET ?from=<종류>:<번호> — 그 대상의 연결(후보·확인·최근 지운 20건, 끝마다 이름·지금 공개 여부·지역 범위). from이 없으면 열린 후보 최근 50건. from 모양이 틀리면 422
//  · POST op=suggest { fromType, fromId } — 같은 지역 자동 후보 찾기(프로젝트·기사·지역 — DB 함수 regional_link_suggest, 공개 대상만, 한 번이라도 있었던 쌍은 다시 0). 감사 regional_link.suggest(만든 수 > 0)
//  · POST op=create { fromType, fromId, toType, toId, relation, reason?, confirm? } — 편집자 연결. confirm=true면 이유 필수 + 바로 확인(도착이 지금 공개여야 — DB가 본다).
//    관광 항목 종류(명소·음식점·관광 정보) 422(PRD-X) · 행사(W6) 422 · 같은 쌍 409 · 없는 대상 422 · 비공개 목적지 확인 409. 감사 regional_link.create 또는 regional_link.confirm
//  · POST op=confirm { linkId, reason, relation? } — 후보 확인(확인자·시각·이유 기록). 비공개 목적지·지역 범위 밖 409(DB 문장). 감사 regional_link.confirm
//  · POST op=remove { linkId, reason } — 지우기(후보·확인 모두, 되살리기 0). 감사 regional_link.remove
// 확인된 연결은 공개 화면(기사 상세 '확인된 연결')에 바로 반영되므로 공개 데이터 캐시를 만료한다.
// 쓰기 작업 본체는 lib/server/regional-links/ops.ts runLinkOp — 프로젝트 관리 API(op=link, 14단계)가 같은 함수를 쓴다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = new URL(request.url).searchParams.get("from");
  const denied = await authorize(viewer, "regional_link.confirm", raw ? `regional_links:from:${raw.slice(0, 40)}` : "regional_links:list");
  if (denied) return denied;
  const from = raw === null ? null : parseLinkRef(raw);
  if (raw !== null && !from) return errorJson(422, "from은 <종류>:<번호> 모양입니다 (예: article:12 · region:1100000000)", { errors: ["from: article·official_source·project·region 중 하나와 번호"] });
  return json(await loadLinkBoard(serviceDb(), from));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const target = typeof body.linkId === "number" ? targetOf.regionalLink(body.linkId) : "regional_links:write";
  // 역할만으로 먼저 판정 — 편집국 외 역할은 입력을 보기 전에 거부하고 감사 로그에 남긴다
  const denied = await authorize(viewer, "regional_link.confirm", target);
  if (denied) return denied;
  return runLinkOp(serviceDb(), actorOf(viewer), op, body);
}, { revalidatesPublic: true });
