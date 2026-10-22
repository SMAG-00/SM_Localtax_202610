"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { EDITOR_RELATIONS, LINK_REASON_MAX, LINK_RELATION_LABELS, LINK_TYPE_LABELS, OPEN_LINK_TYPES, type RegionalLinkRelation } from "@/lib/admin/regional-link-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 지역 연결 편집 폼 (W4 13단계 — PRD-01B REG1-10, /admin/regions/links). 서버 규칙(lib/admin/regional-link-rules.ts)과 같은 칸.
// 관광 항목 종류(명소·음식점·관광 정보)는 고를 수 없다(PRD-X) — 고르기 목록은 기사·공식 자료·프로젝트·지역 허브뿐, 행사는 W6.
// projectId를 주면(프로젝트 관리 화면 — 14단계) 같은 작업을 /api/admin/projects op=link로 보낸다(출발 = 그 프로젝트로 고정).

const RELATION_OPTIONS = EDITOR_RELATIONS.map((r) => ({ value: r, label: LINK_RELATION_LABELS[r] }));
const TYPE_OPTIONS = OPEN_LINK_TYPES.map((t) => ({ value: t, label: LINK_TYPE_LABELS[t] }));
type Failure = { title: string; details: string[] } | null;

function useSubmit(projectId?: number) {
  const router = useRouter();
  const [error, setError] = useState<Failure>(null);
  const [done, setDone] = useState<string | null>(null);
  async function send(body: Record<string, unknown>, ok: (b: Record<string, unknown>) => string) {
    setError(null);
    setDone(null);
    const { op, ...rest } = body;
    const r = projectId ? await adminApi("POST", "/api/admin/projects", { op: "link", project_id: projectId, linkOp: op, ...rest }) : await adminApi("POST", "/api/admin/regional-links", body);
    if (r.status === 200 || r.status === 201) {
      setDone(ok(r.body));
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return { error, done, send };
}

/** [같은 지역 후보 찾기] — 프로젝트·기사·지역 */
export function SuggestLinksButton({ fromType, fromId, projectId }: { fromType: string; fromId: string; projectId?: number }) {
  const hydrated = useHydrated();
  const { error, done, send } = useSubmit(projectId);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send({ op: "suggest", fromType, fromId }, (b) => `같은 지역 후보 ${Number(b.created ?? 0)}건을 더했습니다`);
      }}
      aria-label="같은 지역 후보 찾기"
      data-form="regional-link-suggest"
      className="space-y-2"
    >
      <DarkButton type="submit" disabled={!hydrated}>
        같은 지역 후보 찾기
      </DarkButton>
      {done && <StatusNote>{done}</StatusNote>}
      {error && <ErrorSummary id="rl-suggest-error" title={error.title} messages={error.details} />}
    </form>
  );
}

/** 후보 확인 — 이유 필수(확인 기록), 관계를 함께 고를 수 있다 */
export function ConfirmLinkForm({ id, relation, projectId }: { id: number; relation: RegionalLinkRelation; projectId?: number }) {
  const hydrated = useHydrated();
  const { error, send } = useSubmit(projectId);
  const [reason, setReason] = useState("");
  const [rel, setRel] = useState<string>(relation === "related_event" ? "same_region" : relation);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send({ op: "confirm", linkId: id, reason, relation: rel }, () => "확인했습니다");
      }}
      aria-label={`연결 ${id} 확인`}
      data-form="regional-link-confirm"
      data-link-id={id}
      className="mt-3 grid gap-3 sm:grid-cols-[1fr_14rem]"
    >
      <TextField id={`rl-reason-${id}`} label="확인 이유" hint="예: 같은 구역의 재개발 단계를 다룬 기사" value={reason} maxLength={LINK_REASON_MAX} required onChange={(e) => setReason(e.target.value)} />
      <SelectField id={`rl-relation-${id}`} label="관계" options={RELATION_OPTIONS} value={rel} onChange={(e) => setRel(e.target.value)} />
      {error && (
        <div className="sm:col-span-2">
          <ErrorSummary id={`rl-confirm-error-${id}`} title={error.title} messages={error.details} />
        </div>
      )}
      <div className="sm:col-span-2">
        <DarkButton type="submit" disabled={!hydrated}>
          연결 확인
        </DarkButton>
      </div>
    </form>
  );
}

/** 지우기 — 이유 필수(감사) */
export function RemoveLinkForm({ id, projectId }: { id: number; projectId?: number }) {
  const hydrated = useHydrated();
  const { error, send } = useSubmit(projectId);
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send({ op: "remove", linkId: id, reason }, () => "지웠습니다");
      }}
      aria-label={`연결 ${id} 지우기`}
      data-form="regional-link-remove"
      data-link-id={id}
      className="mt-3 space-y-3"
    >
      <TextField id={`rl-remove-${id}`} label="지우는 이유" value={reason} maxLength={LINK_REASON_MAX} required onChange={(e) => setReason(e.target.value)} />
      {error && <ErrorSummary id={`rl-remove-error-${id}`} title={error.title} messages={error.details} />}
      <DarkButton type="submit" disabled={!hydrated}>
        연결 지우기
      </DarkButton>
    </form>
  );
}

/** 연결 만들기 — 바로 확인하면 이유 필수 */
export function CreateLinkForm({ fromType, fromId, projectId }: { fromType: string; fromId: string; projectId?: number }) {
  const hydrated = useHydrated();
  const { error, done, send } = useSubmit(projectId);
  const [toType, setToType] = useState<string>("article");
  const [toId, setToId] = useState("");
  const [relation, setRelation] = useState<string>("related_tax");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void send({ op: "create", fromType, fromId, toType, toId: toId.trim(), relation, reason, confirm }, () => (confirm ? "연결을 만들고 확인했습니다" : "후보를 만들었습니다"));
      }}
      aria-label="연결 만들기"
      data-form="regional-link-create"
      className="grid gap-4 sm:grid-cols-2"
    >
      <SelectField id="rl-to-type" label="도착 종류" options={TYPE_OPTIONS} value={toType} onChange={(e) => setToType(e.target.value)} hint="명소·맛집 같은 관광 항목은 연결하지 않습니다" />
      <TextField id="rl-to-id" label={toType === "region" ? "행정구역 코드 (10자리)" : "도착 번호"} inputMode="numeric" value={toId} required onChange={(e) => setToId(e.target.value)} />
      <SelectField id="rl-new-relation" label="관계" options={RELATION_OPTIONS} value={relation} onChange={(e) => setRelation(e.target.value)} />
      <TextField id="rl-new-reason" label="이유" hint="바로 확인하면 필수입니다" value={reason} maxLength={LINK_REASON_MAX} onChange={(e) => setReason(e.target.value)} />
      <div className="sm:col-span-2">
        <CheckboxField id="rl-new-confirm" label="바로 확인 (도착이 지금 공개된 것이어야 합니다)" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
      </div>
      {done && (
        <div className="sm:col-span-2">
          <StatusNote>{done}</StatusNote>
        </div>
      )}
      {error && (
        <div className="sm:col-span-2">
          <ErrorSummary id="rl-create-error" title={error.title} messages={error.details} />
        </div>
      )}
      <div className="sm:col-span-2">
        <DarkButton type="submit" disabled={!hydrated}>
          연결 만들기
        </DarkButton>
      </div>
    </form>
  );
}
