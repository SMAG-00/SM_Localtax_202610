-- 바닥글 이전 (PO 요청 2026-10-25) — 옛 사이트 바닥글의 정책 링크·매체 정보·연락처·안내 문구를 새 사이트 바닥글로 옮긴다.
-- · 정책 문서 2종 추가: 청소년보호정책 youth-protection(page_youth_protection) · 저작권보호정책 copyright-policy(page_copyright_policy).
--     policy_versions.doc_key check만 넓힌다. 본문 씨앗 0행 — 정책 본문은 PO가 관리 화면(/admin/pages)에서 붙여 넣고 게시 승인한다(이 파일에 정책 문장 없음).
-- · 기능 키 2개를 꺼짐으로 더한다(이미 값이 있으면 건드리지 않는다). 게시본이 없으면 켜지 못하고 링크도 0.
-- · settings.company_info — 기존 키(W2-e 공개 읽기 정책 settings_public_company_info 그대로)를 확장해 옛 사이트 값을 씨앗으로 넣는다.
--     칸: registered_on 등록일 · registration_no 등록번호 · publisher_editor 발행·편집인 · youth_officer 청소년보호책임자 · corporation 법인명 · name 상호 · representative 대표 ·
--         publisher 발행인 · editor 편집인 · address 주소 · phone 전화 · fax FAX · directions 오시는 길 · copyright_notice 저작권 문구 · open_reporting_notice 열린보도원칙 문구.
--     문구 안의 {제호}는 화면이 제호(코드 brand.mastheadName)로 바꾼다 — 제호가 확정되면 코드 한 줄만 바꾼다. 제호 자체는 설정에 두지 않는다.
--     저장 검사(트리거): 객체 · 아는 칸만 · 글자만 · 한 줄 · 칸별 글자 수 상한 (apps/web/lib/policy/docs.ts companyInfoErrors와 같다). 빈 글자는 그 줄을 숨기는 뜻이라 허용.
--     이미 company_info 값이 있으면 비어 있지 않은 글자 칸은 그대로 두고(운영자 값 우선) 빈 칸만 씨앗으로 채운다.

alter table public.policy_versions drop constraint policy_versions_doc_key_check;
alter table public.policy_versions add constraint policy_versions_doc_key_check check (
  doc_key in ('about', 'editorial-policy', 'ethics', 'corrections', 'ad-policy', 'privacy', 'terms', 'no-email-collection', 'youth-protection', 'copyright-policy', 'advertise')
);

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['page_youth_protection', 'page_copyright_policy']) as k where not (s.value ? k)),
       updated_by = 'migration:20261025000103'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['page_youth_protection', 'page_copyright_policy']) as k where not (s.value ? k));

create function public.company_info_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_max integer;
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '바닥글 회사 정보(company_info)는 객체여야 합니다' using errcode = 'check_violation';
  end if;
  for v_key, v_val in select * from jsonb_each(new.value) loop
    v_max := case v_key
      when 'registered_on' then 40
      when 'registration_no' then 80
      when 'publisher_editor' then 80
      when 'youth_officer' then 80
      when 'corporation' then 120
      when 'name' then 120
      when 'representative' then 80
      when 'publisher' then 80
      when 'editor' then 80
      when 'address' then 200
      when 'phone' then 60
      when 'fax' then 60
      when 'directions' then 300
      when 'copyright_notice' then 400
      when 'open_reporting_notice' then 400
      else null
    end;
    if v_max is null then
      raise exception '바닥글 회사 정보에 모르는 칸이 있습니다 (%)', v_key using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_val) is distinct from 'string' then
      raise exception '바닥글 회사 정보 %는 글자여야 합니다 (비우려면 빈 글자)', v_key using errcode = 'check_violation';
    end if;
    if (v_val #>> '{}') ~ '[\r\n]' then
      raise exception '바닥글 회사 정보 %는 한 줄이어야 합니다', v_key using errcode = 'check_violation';
    end if;
    if char_length(btrim(v_val #>> '{}')) > v_max then
      raise exception '바닥글 회사 정보 %는 %자 이하여야 합니다', v_key, v_max using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.company_info_guard() from public, anon, authenticated;
create trigger settings_company_info_guard
  before insert or update on public.settings
  for each row when (new.key = 'company_info')
  execute function public.company_info_guard();

insert into public.settings (key, value, description, updated_by) values (
  'company_info',
  jsonb_build_object(
    'registered_on', '2009-04-06',
    'registration_no', '성동 라 00032',
    'publisher_editor', '김의효',
    'youth_officer', '원연성',
    'corporation', '한국지방세연구회(주)',
    'address', '서울특별시 성동구 자동차시장1길 18 (화성개발장한평), 504호',
    'phone', '02-2246-2233',
    'fax', '02-2246-5885',
    'copyright_notice', '{제호} 모든 콘텐츠(영상, 기사, 사진)는 저작권법의 보호를 받은바, 무단 전재와 복사, 배포 등을 금합니다.',
    'open_reporting_notice', '「열린보도원칙」 당 매체는 독자와 취재원 등 뉴스이용자의 권리 보장을 위해 반론이나 정정보도, 추후보도를 요청할 수 있는 창구를 열어두고 있음을 알려드립니다.'
  ),
  '바닥글 매체 정보·연락처·안내 문구 (HELP-05) — 옛 사이트 값(PO 제공 2026-10-25). 빈 글자는 그 줄 숨김. 문구 안 {제호}는 코드의 제호(brand.mastheadName)로 바뀐다',
  'migration:20261025000103'
)
on conflict (key) do update
  set value = excluded.value || coalesce((
        select jsonb_object_agg(e.key, e.value)
          from jsonb_each(case when jsonb_typeof(public.settings.value) = 'object' then public.settings.value else '{}'::jsonb end) e
         where jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> ''
           and e.key in ('registered_on', 'registration_no', 'publisher_editor', 'youth_officer', 'corporation', 'name', 'representative', 'publisher', 'editor',
                         'address', 'phone', 'fax', 'directions', 'copyright_notice', 'open_reporting_notice')
      ), '{}'::jsonb),
      updated_by = 'migration:20261025000103';
