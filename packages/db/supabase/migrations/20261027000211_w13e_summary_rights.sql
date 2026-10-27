-- W13-e e4 - 코파일럿 요약 대상 권리 필터 (RES-03 · LIB-06)
-- 출판물 근거 중 '승인 ∧ 요약 권리 확인 ∧ 색인 권리 확인 ∧ 프리미엄'인 것만 돌려준다. 출처 번호는 node:<번호> · issue_article:<번호>.
-- 그 밖의 형식(알 수 없는 번호·존재하지 않는 번호)은 목록에서 빠진다. 서버(service_role)만 부른다.

create function public.copilot_summary_allowed(p_source_ids text[]) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.sid order by t.sid), '{}')
    from (
      select 'node:' || n.id as sid
        from public.pub_nodes n
       where ('node:' || n.id) = any (coalesce(p_source_ids, '{}'))
         and n.status = 'approved' and n.rights_summary = 'confirmed' and n.rights_index = 'confirmed' and n.access_tier = 'premium'
      union all
      select 'issue_article:' || a.id
        from public.magazine_articles a
        join public.magazine_issues i on i.id = a.issue_id
       where ('issue_article:' || a.id) = any (coalesce(p_source_ids, '{}'))
         and a.status = 'approved' and i.status = 'approved' and a.rights_summary = 'confirmed' and a.rights_index = 'confirmed' and a.access_tier = 'premium'
    ) t;
$$;
revoke all on function public.copilot_summary_allowed(text[]) from public, anon, authenticated;
grant execute on function public.copilot_summary_allowed(text[]) to service_role;
