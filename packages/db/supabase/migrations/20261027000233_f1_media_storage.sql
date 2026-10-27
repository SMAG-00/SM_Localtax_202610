-- F1 — 사진 보관(Storage): 공개 읽기 버킷 `media`
-- · 읽기는 누구나(공개 버킷 — 주소를 아는 사람이 파일을 본다). 쓰기·지우기는 서버(service_role)만 — storage.objects 정책을 만들지 않으므로 anon·authenticated 쓰기 0.
-- · 올릴 수 있는 형식 jpg·png·webp, 한 파일 4,000,000바이트 이하 (Vercel 함수 본문 4.5MB 한도 안 — docs/dev/F1_설계.md).
-- · 공개 버킷이라 '권리 확인되지 않은 사진'의 파일 주소도 열려 있다 — 주소는 추측할 수 없는 무작위 이름이고, 화면은 권리 확인된 사진만 그린다(media 표 RLS·발행 판정).
-- 저장소 기능이 있는 환경에서만 (선례: 20261020000028_w2e_inquiries.sql)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 4000000, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = true, file_size_limit = 4000000, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  end if;
end;
$$;
