-- W2-c 4단계 DB — 형식 콘텐츠: 인포그래픽·동영상·포토 (ART-07 · ART-08 · ART-09, docs/dev/W2-c_설계.md 8.4)
-- · media.width·height — 이미지 원본의 가로·세로(픽셀). 둘 다 있거나 둘 다 없고, 1~20000.
--   동영상 썸네일 16:9 발행 판정(ART-08 '썸네일 16:9 원본 비율' — packages/editorial art08.thumbnail-ratio)과
--   공개 화면의 자리 확보(img width·height — 원본 비율 그대로 줄이고 자르지 않는다, 화면 밀림 0)에 쓴다.
--   공개 칸(anon 칸 권한)에 더한다 — 공개된 그림 파일에서 누구나 알 수 있는 값이다. 행 범위는 그대로(권리 확인 + 읽을 수 있는 기사의 그림)
-- · articles.body_media_ids(계산 칸) — 본문 이미지·인포그래픽 블록의 media 번호에 동영상 블록의 썸네일(thumbnailMediaId)을 더한다.
--   공개 읽기 정책 media_public_read가 이 칸으로 '읽을 수 있는 기사의 본문 그림'을 고르므로, 썸네일도 같은 규칙으로만 anon에게 보인다
--   (초안 기사의 썸네일 0 · 권리 미확인 썸네일 0)
-- · settings.feature_flags에 video_list(동영상 목록 /news/video) — 꺼짐. 동영상 채널 결정 전에는 동영상 목록을 숨긴다
--   (PRD-01A 1.3 '동영상 채널 — 없으면 동영상 목록은 숨긴다' · 13장 결정 안건). 이미 다른 값이 있으면 건드리지 않는다

alter table public.media
  add column width integer,
  add column height integer,
  add constraint media_size_pair check ((width is null) = (height is null)),
  add constraint media_size_range check (width is null or (width between 1 and 20000 and height between 1 and 20000));

comment on column public.media.width is '원본 가로(픽셀) — height와 함께 있거나 함께 없다. 동영상 썸네일 16:9 판정·화면 자리 확보 (ART-08 · ART-09)';
comment on column public.media.height is '원본 세로(픽셀) — width와 함께';

grant select (width, height) on table public.media to anon, authenticated;

alter table public.articles
  alter column body_media_ids set expression as (
    jsonb_path_query_array(body, '$.blocks[*] ? (@.type == "image" || @.type == "infographic").mediaId')
    || jsonb_path_query_array(body, '$.blocks[*] ? (@.type == "video" && @.thumbnailMediaId != null).thumbnailMediaId'));

comment on column public.articles.body_media_ids is '본문 이미지·인포그래픽 블록의 media 번호와 동영상 블록의 썸네일 번호 (계산 칸) — media 공개 읽기 정책이 쓴다';

update public.settings
   set value = value || jsonb_build_object('video_list', false),
       updated_by = 'migration:20261018000017'
 where key = 'feature_flags'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'video_list');
