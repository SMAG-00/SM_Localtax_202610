-- W4 26단계 — 기능 키 inheritance_gift 켜기 조건 (docs/dev/W4_설계.md 2.4 · 11.26, 23단계 '하지 않은 것'을 닫는다)
-- · 세무 게이트 승인 기록(TX-06) = 입문 기사의 세무 감수 승인 기록(editorial_reviews kind tax_review·decision approve) — 별도 표를 더하지 않는다
--   (W3 설계 12장 #36: 국세 세액 예시 차단은 기사의 세무 감수 체크리스트가 맡는다)
-- · 켜는 순간(꺼짐/없음 → 켜짐)에만 검사: 하위 분야 realestate/inheritance-gift의 공개 해설 기사 가운데 세무 감수가 승인된 것이 1건 이상 + 고지 문구가 있어야 한다.
--   끄기·이미 켜진 값은 검사하지 않는다 (dev_methods_flag_guard와 같은 방식)
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

create function public.inheritance_gift_gate_missing() returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
  v_notice jsonb;
begin
  if not exists (
    select 1
      from public.public_articles a
      join public.articles x on x.id = a.id and x.tax_review_status = 'approved'
      join public.categories c on c.id = a.category_id and c.section = 'realestate' and c.slug = 'inheritance-gift'
     where a.content_type = 'explainer'
       and exists (select 1 from public.editorial_reviews er where er.article_id = a.id and er.kind = 'tax_review' and er.decision = 'approve')) then
    v_missing := v_missing || '세무 감수가 승인된 입문 기사(공개 해설) 1건'::text;
  end if;
  select s.value into v_notice from public.settings s where s.key = 'inheritance_gift_notice';
  if jsonb_typeof(v_notice) is distinct from 'string' or btrim(v_notice #>> '{}') = '' then
    v_missing := v_missing || '고지 문구'::text;
  end if;
  if cardinality(v_missing) = 0 then
    return null;
  end if;
  return array_to_string(v_missing, '·');
end;
$$;
revoke all on function public.inheritance_gift_gate_missing() from public, anon, authenticated;
grant execute on function public.inheritance_gift_gate_missing() to service_role;

create function public.inheritance_gift_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'inheritance_gift') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'inheritance_gift') is distinct from 'true'::jsonb) then
    v_missing := public.inheritance_gift_gate_missing();
    if v_missing is not null then
      raise exception '상속·증여 안내(inheritance_gift)는 세무 게이트 승인 기록과 고지가 있어야 켭니다 — 아직: %', v_missing
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.inheritance_gift_flag_guard() from public, anon, authenticated;
create trigger settings_inheritance_gift_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.inheritance_gift_flag_guard();
