-- W13-a a7 - 필자 페이지 연결용 공개 뷰 (PRD-05 LIB-03 칼럼 아카이브)
-- 필자(people)의 지식창고 항목 목록 - 권호 기사(공개 조건 통과분)와 프리미엄 칼럼(발행·판매 권리·기능 키 library_premium 통과분). 제목과 번호뿐, 본문·요약 칸 0.
-- 권리 미확인 항목은 앞선 두 공개 뷰가 이미 걸러 내므로 필자 페이지 목록에도 나오지 않는다. 비공개 필자는 제외한다.

create view public.public_library_author_items as
select 'issue_article'::text as kind, a.id, a.title, p.slug as author_slug, a.issue_id as parent_id, i.issued_on as published_on
  from public.public_library_issue_articles a
  join public.magazine_issues i on i.id = a.issue_id
  join public.people p on p.id = a.author_person_id
 where p.visibility = 'public'
union all
select 'column'::text, c.id, c.title, p.slug, c.series_id, c.first_published_at::date
  from public.public_library_columns c
  join public.people p on p.id = c.author_person_id
 where p.visibility = 'public';
revoke all on table public.public_library_author_items from public, anon, authenticated, service_role;
grant select on table public.public_library_author_items to anon, authenticated, service_role;
