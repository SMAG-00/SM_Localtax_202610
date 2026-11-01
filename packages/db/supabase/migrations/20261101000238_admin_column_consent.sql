-- 관리자(PO) 본인 칼럼 — 이름·초상 동의서 검사도 건너뜁니다 (PO 2026-11-01 "왜 이렇게 복잡하게 만들었어?" — 237번의 후속)
-- · 동의서(public_name_consents, 범위 column)는 남의 이름을 칼럼에 싣기 위한 기록입니다. 관리자 본인이 자기 칼럼을 직접 발행하면
--   발행 행위가 곧 본인 동의이므로 따로 받지 않습니다. 표시는 237번과 같은 발행 기록 check_log.publish.adminColumnPublish = true
--   (서버만 씁니다 — articles는 authenticated·anon 쓰기 정책이 없습니다)
-- · 다른 필자의 칼럼은 그대로 동의서가 있어야 발행됩니다 (035번 본문 그대로, 표시 조건 한 줄만 더함)
-- · column_publish_guard(034) — 같은 표시면 필자 검증·기고 계약·이해관계 기록(column_meta)을 보지 않습니다. 기능 키 tax_columns가 켜져 있으면 의견 고지 문구 검사만 남깁니다

create or replace function public.column_consent_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('published', 'scheduled') or new.content_type is distinct from 'opinion' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') and old.content_type is not distinct from new.content_type
     and old.author_id is not distinct from new.author_id then
    return new;
  end if;
  if new.author_id is null then
    return new; -- 필자 이름이 없는 글은 이름 사용이 아니다 (필자 요건은 칼럼 필자 체계 34가 따로 본다)
  end if;
  if (new.check_log -> 'publish' -> 'adminColumnPublish') is not distinct from 'true'::jsonb then
    return new; -- 관리자 본인 칼럼 발행 (237) — 본인 이름은 본인이 싣는다
  end if;
  if not exists (select 1 from public.public_name_consents c where c.person_id = new.author_id and 'column' = any (c.scope)) then
    raise exception '필자의 이름·초상 동의서(현재 버전, 범위 column)가 없어 칼럼을 발행할 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.column_publish_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.column_meta;
  v_flag boolean;
  v_notice text;
begin
  if new.status not in ('published', 'scheduled') or new.content_type is distinct from 'opinion' then
    return new;
  end if;
  -- 이미 공개된 칼럼은 그대로 둔다 (검증 만료 = 새 발행만 막힘)
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') then
    return new;
  end if;
  select * into m from public.column_meta where article_id = new.id;
  select coalesce((value ->> 'tax_columns')::boolean, false) into v_flag from public.settings where key = 'feature_flags';
  -- 관리자(PO) 본인 칼럼 발행 (237·238) — 필자 검증·기고 계약·이해관계 기록은 외부 필자용이라 건너뛴다. 기능 키가 켜져 있으면 의견 고지 문구만 본다
  if (new.check_log -> 'publish' -> 'adminColumnPublish') is not distinct from 'true'::jsonb then
    select coalesce(btrim(value #>> '{}'), '') into v_notice from public.settings where key = 'column_opinion_notice';
    if coalesce(v_flag, false) and coalesce(v_notice, '') = '' then
      raise exception '의견 고지 문구(column_opinion_notice)가 비어 있어 칼럼을 발행할 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if m.article_id is null and not coalesce(v_flag, false) then
    return new;
  end if;
  if m.article_id is null then
    raise exception '칼럼은 필자·계약·이해관계 기록(column_meta) 뒤에만 발행할 수 있습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if new.author_id is distinct from m.person_id then
    raise exception '칼럼 기록의 필자와 기사 필자가 다릅니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.author_verifications v where v.person_id = m.person_id and v.expires_at > now()
  ) then
    raise exception '필자 검증이 없거나 재검증 기한이 지났습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if m.contract_id is null then
    raise exception '기고 계약 기록이 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  select coalesce(btrim(value #>> '{}'), '') into v_notice from public.settings where key = 'column_opinion_notice';
  if coalesce(v_notice, '') = '' then
    raise exception '의견 고지 문구(column_opinion_notice)가 비어 있어 칼럼을 발행할 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
