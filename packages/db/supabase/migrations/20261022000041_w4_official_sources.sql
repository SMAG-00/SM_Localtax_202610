-- W4 5단계 — 공식 자료 규칙 (PRD-01B REG1-07 · REG1-09 · REG1-13 · PR-07, docs/dev/W4_설계.md 1장 5단계 · 2.1 · 2.2 · 3장 · 12장 #13·#22)
-- 이 파일에 실제 공식 자료·공공누리 표시 내용은 없다 — 편집국이 원문을 보고 입력한다. 값 목록만 정한다.
-- · article_sources.license_type (공공누리 6값) — 공식 자료(official_doc·dataset)·보도자료(press_release)·사진(photo) 행은 필수 (PR-07).
--     NOT VALID: 이미 있는 행의 유형을 지어내지 않는다 — 새 행과 고치는 행부터 검사하고, 비어 있는 옛 행은 발행 검사가 막는다.
-- · 자료 종류(source_type) — 공식 자료 행에만, 설정 official_source_types(허용 목록, 씨앗 6종)의 값만. 차단 4종(교통·관광·음식점·생활 안내)은
--     코드 고정 — 출처에도 설정에도 넣을 수 없다 (REG1-07). 비어 있으면 검사하지 않는다(국세·지방세 법령 출처는 6종 밖이라 비운다).
-- · 원자료 새 버전 (REG1-09) — 공식 자료 행의 값이 있던 칸은 고칠 수 없다(덮어쓰기 0). 바꾸려면 새 행(supersedes_id + 수정 사유 — W2-a 칸 재사용)을
--     넣는다. 빈 칸 채우기와 확인일(last_verified_at) 갱신은 그대로 된다. 한 행은 한 번만 대체되고, 대체는 같은 기사 안에서만. 스냅샷 행은 건드리지 않는다.
-- · 발행 검사 (REG1-09 · REG1-13 · PR-07 — 발행 서비스 @ltr/editorial과 양쪽): 기사가 published·scheduled가 될 때 대체되지 않은 공식 자료마다
--     발표일·기준일·지역 단위·수집일·확인일·공공누리 유형, 보도자료·사진 출처는 공공누리 유형. 이미 발행된 기사에 넣는 출처도 같은 검사.
--     고시(notice)·조례(ordinance) 자료를 쓴 해설(explainer·guide)은 세무 감수 승인(tax_review_status = approved) 없이 발행 거부 (REG1-07).
-- · media.license_type (공공누리 6값 — 권리 확인(confirmed) 이미지는 필수, NOT VALID. 미확인 초안 이미지는 W2-a처럼 칸 없이 저장되고 공개 0) · media.crop_allowed (기본 true — 12장 #22) · media.license_cleared (계산 칸) —
--     공개 렌더 가능 = 유형이 설정 kogl_usage.photoTypes에 있음. 씨앗 = 제1유형·자체 촬영(not_applicable)만 — 제2·3유형은 법률 검토 전 0 (12장 #13 권고 기본값).
--     제4유형·미표시(unmarked)는 코드 고정으로 늘 0 — 설정에도 넣을 수 없다 (PR-07). 설정을 바꾸면 모든 이미지의 계산 칸을 다시 계산한다.
--     공개 읽기 정책(media_public_read)에 이 칸을 더한다 — 공개 화면·목록·사이트맵 원본이 모두 같은 규칙을 따른다.
-- · 설정 kogl_usage.fullTextTypes (씨앗 []) — 원문 본문을 옮겨도 되는 유형. 1단계 권고는 모든 유형 전재 0(링크·요약) — 발행 판정(@ltr/editorial
--     pr07.full-text)이 유사도 검사기로 옮긴 문장을 잡는다. 제4유형·미표시는 여기에도 넣을 수 없다.
-- · 기존 표·칸·제약·값은 바꾸지 않는다 (license_status 자유 글자 칸은 그대로 — 판정은 새 칸으로)

-- ─────────────────────────────────────────────────────────────
-- 칸 더하기
-- ─────────────────────────────────────────────────────────────
alter table public.article_sources
  add column license_type text constraint article_sources_license_type_check
    check (license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable'));

comment on column public.article_sources.license_type is '공공누리 유형 (PR-07) — kogl_1~4 제1~4유형 · unmarked 미표시 · not_applicable 해당 없음. 공식 자료·보도자료·사진 행은 필수';

alter table public.article_sources
  add constraint article_sources_license_required
    check (kind not in ('official_doc', 'dataset', 'press_release', 'photo') or license_type is not null) not valid;

create unique index article_sources_supersedes_once on public.article_sources (supersedes_id) where supersedes_id is not null;

alter table public.media
  add column license_type text constraint media_license_type_check
    check (license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  add column crop_allowed boolean not null default true,
  add column license_cleared boolean not null default false;

comment on column public.media.license_type is '공공누리 유형 (PR-07) — 권리 확인(confirmed) 이미지는 필수. 자체 촬영·자체 제작은 not_applicable';
comment on column public.media.crop_allowed is '자르기 허용 (REG1-09) — false면 공개 렌더 가로세로비 = 원본';
comment on column public.media.license_cleared is '공개 렌더 가능 (계산 칸 — media_license_guard가 settings.kogl_usage.photoTypes로 계산). 제4유형·미표시는 늘 false';

alter table public.media
  add constraint media_license_required check (rights_status <> 'confirmed' or license_type is not null) not valid;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 2.2 official_source_types(허용 6종) · kogl_usage(12장 #13 권고 기본값)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('official_source_types',
   '["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"]'::jsonb,
   '공식 자료 종류 허용 목록 (REG1-07) — 조례·고시·예산/결산·지방세 세수·부동산 거래/공시·정비/개발. 교통·관광·음식점·생활 안내(transport·tourism·restaurant·living_guide)는 넣을 수 없다(코드 고정)',
   'migration:20261022000041'),
  ('kogl_usage',
   '{"photoTypes": ["kogl_1", "not_applicable"], "fullTextTypes": []}'::jsonb,
   '공공누리 이용 범위 (PR-07 · W4 12장 #13) — photoTypes 게시하는 사진 유형, fullTextTypes 원문 본문을 옮겨도 되는 유형. 1단계 권고: 사진은 제1유형·자체 촬영만, 원문 전재는 모든 유형 0. 제4유형·미표시(kogl_4·unmarked)는 넣을 수 없다(코드 고정)',
   'migration:20261022000041')
on conflict (key) do nothing;

-- 설정 저장 검사 — 허용 목록·이용 범위 (운영 설정 API lib/admin/official-source-rules.ts와 같은 규칙)
create function public.official_source_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_allowed text[];
begin
  if new.key = 'official_source_types' then
    if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value) = 0 or jsonb_array_length(new.value) > 50 then
      raise exception '공식 자료 종류 허용 목록(official_source_types)은 종류 1~50개의 목록이어야 합니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') !~ '^[a-z][a-z0-9_]{1,39}$' then
        raise exception '공식 자료 종류는 영문 소문자·숫자·_ 2~40자입니다 (지금 %)', v_item using errcode = 'check_violation';
      end if;
      if (v_item #>> '{}') in ('transport', 'tourism', 'restaurant', 'living_guide') then
        raise exception '자료 종류 %는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 — 허용 목록에도 넣을 수 없습니다 (REG1-07 코드 고정)', v_item #>> '{}' using errcode = 'check_violation';
      end if;
      if (v_item #>> '{}') = any (v_seen) then
        raise exception '자료 종류 %가 두 번 있습니다', v_item #>> '{}' using errcode = 'check_violation';
      end if;
      v_seen := v_seen || (v_item #>> '{}');
    end loop;
  elsif new.key = 'kogl_usage' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) k where k not in ('photoTypes', 'fullTextTypes'))
       or not (new.value ? 'photoTypes' and new.value ? 'fullTextTypes') then
      raise exception '공공누리 이용 범위(kogl_usage)는 {"photoTypes": [...], "fullTextTypes": [...]} 두 칸만 씁니다' using errcode = 'check_violation';
    end if;
    foreach v_key in array array['photoTypes', 'fullTextTypes'] loop
      v_allowed := case when v_key = 'photoTypes' then array['kogl_1', 'kogl_2', 'kogl_3', 'not_applicable'] else array['kogl_1', 'kogl_2', 'kogl_3'] end;
      if jsonb_typeof(new.value -> v_key) is distinct from 'array' then
        raise exception '공공누리 이용 범위의 %는 유형 목록이어야 합니다', v_key using errcode = 'check_violation';
      end if;
      v_seen := '{}';
      for v_item in select x.value from jsonb_array_elements(new.value -> v_key) as x loop
        if (v_item #>> '{}') in ('kogl_4', 'unmarked') then
          raise exception '공공누리 제4유형·미표시(%)는 설정으로도 열 수 없습니다 — 링크·요약만 씁니다 (PR-07 코드 고정)', v_item #>> '{}' using errcode = 'check_violation';
        end if;
        if jsonb_typeof(v_item) is distinct from 'string' or not ((v_item #>> '{}') = any (v_allowed)) then
          raise exception '공공누리 이용 범위의 %에는 %만 넣습니다 (지금 %)', v_key, array_to_string(v_allowed, '·'), v_item using errcode = 'check_violation';
        end if;
        if (v_item #>> '{}') = any (v_seen) then
          raise exception '공공누리 이용 범위의 %에 %가 두 번 있습니다', v_key, v_item #>> '{}' using errcode = 'check_violation';
        end if;
        v_seen := v_seen || (v_item #>> '{}');
      end loop;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.official_source_settings_guard() from public, anon, authenticated;
create trigger settings_official_source_guard
  before insert or update on public.settings
  for each row when (new.key in ('official_source_types', 'kogl_usage'))
  execute function public.official_source_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 이미지 — 공개 렌더 가능 계산 (PR-07)
-- ─────────────────────────────────────────────────────────────
create function public.media_license_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_types jsonb;
begin
  select s.value -> 'photoTypes' into v_types from public.settings s where s.key = 'kogl_usage';
  new.license_cleared := new.license_type is not null
    and new.license_type not in ('kogl_4', 'unmarked')
    and coalesce(jsonb_typeof(v_types) = 'array' and v_types ? new.license_type, false);
  return new;
end;
$$;
revoke all on function public.media_license_guard() from public, anon, authenticated;
create trigger media_license_guard
  before insert or update on public.media
  for each row execute function public.media_license_guard();

-- 이용 범위를 바꾸면 모든 이미지의 계산 칸을 다시 (위 트리거가 새 설정으로 계산한다)
create function public.kogl_usage_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.media m
     set license_cleared = m.license_cleared
   where true;
  return null;
end;
$$;
revoke all on function public.kogl_usage_sync() from public, anon, authenticated;
create trigger settings_kogl_usage_sync
  after insert or update on public.settings
  for each row when (new.key = 'kogl_usage')
  execute function public.kogl_usage_sync();

-- ─────────────────────────────────────────────────────────────
-- 공식 자료 — 비어 있는 필수 칸 (발행 검사 한 곳. 글자는 편집 화면 칸 이름 + API 칸 이름)
-- ─────────────────────────────────────────────────────────────
create function public.official_source_missing(s public.article_sources) returns text[]
language sql
immutable
as $$
  select array_remove(array[
    case when s.kind in ('official_doc', 'dataset') and s.published_on is null then '발표일(publishedOn)' end,
    case when s.kind in ('official_doc', 'dataset') and s.reference_date is null then '기준일(referenceDate)' end,
    case when s.kind in ('official_doc', 'dataset') and coalesce(btrim(s.region_unit), '') = '' then '지역 단위(regionUnit)' end,
    case when s.kind in ('official_doc', 'dataset') and s.collected_at is null then '수집일(collectedAt)' end,
    case when s.kind in ('official_doc', 'dataset') and s.last_verified_at is null then '확인일(lastVerifiedAt)' end,
    case when s.kind in ('official_doc', 'dataset', 'press_release', 'photo') and s.license_type is null then '공공누리 유형(licenseType)' end
  ], null);
$$;
revoke all on function public.official_source_missing(public.article_sources) from public, anon, authenticated;

-- 기사 하나의 발행 문제 — 첫 문제 문장 하나(없으면 null). 대체된 출처는 보지 않는다
create function public.official_source_publish_problem(p_article public.articles) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_src public.article_sources;
  v_missing text[];
begin
  for v_src in
    select s.* from public.article_sources s
     where s.article_id = p_article.id
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
     order by s.id
  loop
    v_missing := public.official_source_missing(v_src);
    if cardinality(v_missing) > 0 then
      return format('출처 src:%s「%s」의 %s이(가) 비어 발행할 수 없습니다 — 공식 자료는 발표일·기준일·지역 단위·수집일·확인일·공공누리 유형, 보도자료·사진은 공공누리 유형이 필요합니다 (REG1-09 · PR-07, 기사 %s)',
        v_src.id, coalesce(v_src.title, ''), array_to_string(v_missing, '·'), p_article.id);
    end if;
  end loop;
  if p_article.content_type in ('explainer', 'guide')
     and p_article.tax_review_status is distinct from 'approved'
     and exists (select 1 from public.article_sources s
                  where s.article_id = p_article.id and s.source_type in ('notice', 'ordinance')
                    and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)) then
    return format('고시·조례 자료를 쓴 해설은 세무 감수 승인 뒤에만 발행할 수 있습니다 (REG1-07, 기사 %s)', p_article.id);
  end if;
  return null;
end;
$$;
revoke all on function public.official_source_publish_problem(public.articles) from public, anon, authenticated;

-- 발행 검사 — 기사가 published·scheduled가 될 때 (이미 발행된 기사의 다른 칸 고치기·이미지 권리 동기화는 막지 않는다)
create function public.articles_official_sources_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.status in ('published', 'scheduled') and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled')) then
    v_problem := public.official_source_publish_problem(new);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.articles_official_sources_guard() from public, anon, authenticated;
create trigger articles_official_sources_guard
  before insert or update on public.articles
  for each row execute function public.articles_official_sources_guard();

-- 출처 저장 검사 — 자료 종류 · 원자료 덮어쓰기 0 · 대체 규칙 · 이미 발행된 기사에 넣는 출처
create function public.article_sources_official_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_types jsonb;
  v_changed text;
  v_target public.article_sources;
  v_article public.articles;
  v_missing text[];
begin
  -- 자료 종류 (REG1-07) — 공식 자료 행에만, 허용 목록 값만, 차단 4종은 늘 거부
  if new.source_type is not null and (tg_op = 'INSERT' or new.source_type is distinct from old.source_type) then
    if new.kind not in ('official_doc', 'dataset') then
      raise exception '자료 종류(sourceType)는 공식 자료(official_doc·dataset) 출처에만 씁니다 (REG1-07)' using errcode = 'check_violation';
    end if;
    if new.source_type in ('transport', 'tourism', 'restaurant', 'living_guide') then
      raise exception '자료 종류 %는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)', new.source_type using errcode = 'check_violation';
    end if;
    select s.value into v_types from public.settings s where s.key = 'official_source_types';
    if not coalesce(jsonb_typeof(v_types) = 'array' and v_types ? new.source_type, false) then
      raise exception '자료 종류 %는 허용 목록(official_source_types)에 없습니다 (REG1-07)', new.source_type using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- 원자료 덮어쓰기 0 (REG1-09) — 값이 있던 칸은 새 버전 행으로만. 빈 칸(null·공백 글자) 채우기·확인일 갱신은 된다
    if old.kind in ('official_doc', 'dataset') then
      select string_agg(o.key, '·' order by o.key) into v_changed
        from jsonb_each(to_jsonb(old)) o
       where o.key <> 'last_verified_at'
         and o.value <> 'null'::jsonb
         and not (jsonb_typeof(o.value) = 'string' and btrim(o.value #>> '{}') = '')
         and (to_jsonb(new) -> o.key) is distinct from o.value;
      if v_changed is not null then
        raise exception '원자료(공식 자료 src:%)의 %은(는) 고칠 수 없습니다 — 새 버전 행(supersedes_id + 수정 사유)으로 기록하세요 (REG1-09)', old.id, v_changed
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- 새 버전은 같은 기사의 출처만 대체한다
  if new.supersedes_id is not null and (tg_op = 'INSERT' or new.supersedes_id is distinct from old.supersedes_id) then
    select * into v_target from public.article_sources where id = new.supersedes_id;
    if v_target.id is not null and v_target.article_id <> new.article_id then
      raise exception '다른 기사의 출처(src:%)를 대체할 수 없습니다 (REG1-09)', new.supersedes_id using errcode = 'check_violation';
    end if;
  end if;

  -- 이미 발행된(예약된) 기사에 넣거나 고치는 출처도 발행 검사와 같은 규칙 (한쪽만 우회한 삽입도 실패 — REG1-13)
  select * into v_article from public.articles where id = new.article_id;
  if v_article.status in ('published', 'scheduled') then
    v_missing := public.official_source_missing(new);
    if cardinality(v_missing) > 0 then
      raise exception '발행된 기사(%)의 출처「%」에 %이(가) 비었습니다 (REG1-09 · PR-07)', v_article.id, coalesce(new.title, ''), array_to_string(v_missing, '·')
        using errcode = 'check_violation';
    end if;
    if new.source_type in ('notice', 'ordinance') and v_article.content_type in ('explainer', 'guide')
       and v_article.tax_review_status is distinct from 'approved' then
      raise exception '고시·조례 자료를 쓴 해설은 세무 감수 승인 뒤에만 발행할 수 있습니다 (REG1-07, 기사 %)', v_article.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.article_sources_official_guard() from public, anon, authenticated;
create trigger article_sources_official_guard
  before insert or update on public.article_sources
  for each row execute function public.article_sources_official_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 읽기 — 새 칸 (공공누리 배지·자르기) · 이미지는 공개 렌더 가능(license_cleared)만
-- ─────────────────────────────────────────────────────────────
grant select (license_type) on table public.article_sources to anon, authenticated;
grant select (license_type, crop_allowed) on table public.media to anon, authenticated;

drop policy media_public_read on public.media;
create policy media_public_read on public.media
  for select to anon, authenticated
  using (
    rights_status = 'confirmed'
    and license_cleared
    and exists (
      select 1 from public.articles a
       where a.lead_media_id = media.id
          or a.body_media_ids @> jsonb_build_array(media.id::text)
          or a.body_media_ids @> jsonb_build_array(media.id)));
