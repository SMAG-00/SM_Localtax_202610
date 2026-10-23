-- W4 20단계 뒷부분 — 기사 '법안 상태를 다룸' 표시 + 발행 검사 (PRD-01B PR-13 · REG1-13, docs/dev/W4_설계.md 1장 20단계 · 11.20 · 12장 #167·#169)
-- 이 파일에 법안·특례법 이름이나 조문 내용은 없다 — 표시 칸과 발행 규칙만 정한다.
-- · articles.covers_bill_status (기본 false) — 기사가 법안(국회 계류 중 등 확정 전 법)의 상태를 다룬다는 편집자 표시.
-- · 발행 검사 — 표시가 켜진 기사가 published·scheduled가 될 때(또는 이미 발행·예약된 기사에 표시를 켤 때), 대체되지 않은 공식 자료 출처
--   (article_sources kind = official_doc·dataset) 중 출처 주소(source_url)와 확인일(last_verified_at)이 모두 있는 것이 1건 이상이어야 한다.
--   없으면 발행 거부 — 무엇이 빠졌는지 문장에 담는다. 발행 서비스(@ltr/editorial checks/bill-status.ts)와 같은 규칙을 DB가 한 번 더 본다.
-- · 표시가 꺼진 기사는 아무것도 달라지지 않는다. 공개 뷰·공개 화면은 이 칸을 읽지 않는다(칸 권한 추가 0).
-- 기존 표·칸·제약·값은 바꾸지 않는다.

alter table public.articles add column covers_bill_status boolean not null default false;
comment on column public.articles.covers_bill_status is '법안 상태를 다룸 (PR-13) — 켜면 공식 자료 출처(출처 주소 + 확인일) 1건 이상이 있어야 발행·예약된다. 확인 전 법안은 출처·확인일과 함께 기사로만 다룬다';

-- 한 기사의 문제 문장(없으면 null)
create function public.bill_status_publish_problem(p_article public.articles) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_ok integer;
  v_url_missing integer;
  v_date_missing integer;
begin
  if not p_article.covers_bill_status then
    return null;
  end if;
  select count(*),
         count(*) filter (where length(btrim(coalesce(s.source_url, ''))) > 0 and s.last_verified_at is not null),
         count(*) filter (where length(btrim(coalesce(s.source_url, ''))) = 0),
         count(*) filter (where s.last_verified_at is null)
    into v_total, v_ok, v_url_missing, v_date_missing
    from public.article_sources s
   where s.article_id = p_article.id
     and s.kind in ('official_doc', 'dataset')
     and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id);
  if v_ok > 0 then
    return null;
  end if;
  if v_total = 0 then
    return format('법안 상태를 다룬 기사는 공식 자료 출처가 1건 이상 있어야 발행할 수 있습니다 — 출처 주소와 확인일을 적은 공식 자료(official_doc·dataset)를 더하세요 (PR-13 · REG1-13, 기사 %s)', p_article.id);
  end if;
  return format('법안 상태를 다룬 기사는 출처 주소와 확인일이 모두 있는 공식 자료 출처가 1건 이상 있어야 발행할 수 있습니다 — 빠진 것: %s (PR-13 · REG1-13, 기사 %s)',
    array_to_string(array_remove(array[
      case when v_url_missing > 0 then '출처 주소(sourceUrl)' end,
      case when v_date_missing > 0 then '확인일(lastVerifiedAt)' end
    ], null), '·'), p_article.id);
end;
$$;
revoke all on function public.bill_status_publish_problem(public.articles) from public, anon, authenticated;

create function public.articles_bill_status_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.covers_bill_status and new.status in ('published', 'scheduled')
     and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled') or not old.covers_bill_status) then
    v_problem := public.bill_status_publish_problem(new);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.articles_bill_status_guard() from public, anon, authenticated;
create trigger articles_bill_status_guard
  before insert or update on public.articles
  for each row execute function public.articles_bill_status_guard();
