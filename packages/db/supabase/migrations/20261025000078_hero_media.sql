-- 히어로 배경 영상·그림 설정 (PO 결정 2026-10-25) — 홈은 화면 전체 배경 영상, 분야 허브(/tax·/realestate·/finance·/local) 머리는 절반 높이.
-- · hero_media — { home|tax|realestate|finance|local: { video, videoMobile, poster, posterMobile, card }, aiLabel }. 파일은 /media/hero/ 안의 공개 파일만.
--     씨앗: 홈은 영상 + 포스터, 네 허브는 영상 없이 포스터 정지 그림 (PO가 영상 02~05를 주면 설정만 바꾼다). 값이 없거나 틀리면 화면은 지금의 어두운 그라데이션
--     aiLabel — 화면 구석 'AI 생성 영상' 표시 (인공지능 기본법 표시 의무 — 기본 켜짐)
--     저장 검사(트리거): 객체 · 아는 키만(5곳 + aiLabel) · 칸 이름 5개 · 경로는 /media/hero/파일명 (바깥 주소·하위 폴더·.. 불가) · 영상 .mp4/.webm · 그림 .avif/.webp/.jpg/.png
--     공개 읽기 — anon이 이 키 한 줄만 읽는 정책. 기존 settings_public_read는 그대로
-- · 기존 표·칸·제약은 바꾸지 않는다 (씨앗 한 줄 · 트리거 · 정책만 더한다). 검사는 apps/web/lib/site/hero-media.ts와 같다

create function public.hero_media_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_field text;
  v_path jsonb;
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '히어로 배경 설정(hero_media)은 객체여야 합니다' using errcode = 'check_violation';
  end if;
  for v_key, v_val in select * from jsonb_each(new.value) loop
    if v_key = 'aiLabel' then
      if jsonb_typeof(v_val) is distinct from 'boolean' then
        raise exception '히어로 배경 설정 aiLabel은 true 또는 false여야 합니다' using errcode = 'check_violation';
      end if;
      continue;
    end if;
    if v_key not in ('home', 'tax', 'realestate', 'finance', 'local') then
      raise exception '히어로 배경 설정에 모르는 칸이 있습니다 (%) — home·tax·realestate·finance·local·aiLabel만 씁니다', v_key using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_val) is distinct from 'object' then
      raise exception '히어로 배경 설정 %은 객체여야 합니다', v_key using errcode = 'check_violation';
    end if;
    for v_field, v_path in select * from jsonb_each(v_val) loop
      if v_field not in ('video', 'videoMobile', 'poster', 'posterMobile', 'card') then
        raise exception '히어로 배경 설정 %.%는 모르는 칸입니다 — video·videoMobile·poster·posterMobile·card만 씁니다', v_key, v_field using errcode = 'check_violation';
      end if;
      if v_path = 'null'::jsonb or v_path = '""'::jsonb then
        continue;
      end if;
      if jsonb_typeof(v_path) is distinct from 'string' then
        raise exception '히어로 배경 설정 %.%는 파일 경로 글자여야 합니다', v_key, v_field using errcode = 'check_violation';
      end if;
      if (v_path #>> '{}') !~ '^/media/hero/[A-Za-z0-9][A-Za-z0-9._-]*$' then
        raise exception '히어로 배경 설정 %.%는 /media/hero/ 안의 파일 경로여야 합니다 (바깥 주소·하위 폴더·.. 불가): %', v_key, v_field, v_path #>> '{}' using errcode = 'check_violation';
      end if;
      if v_field in ('video', 'videoMobile') and (v_path #>> '{}') !~* '\.(mp4|webm)$' then
        raise exception '히어로 배경 설정 %.%는 .mp4 또는 .webm 영상이어야 합니다', v_key, v_field using errcode = 'check_violation';
      end if;
      if v_field not in ('video', 'videoMobile') and (v_path #>> '{}') !~* '\.(avif|webp|jpe?g|png)$' then
        raise exception '히어로 배경 설정 %.%는 .avif·.webp·.jpg·.png 그림이어야 합니다', v_key, v_field using errcode = 'check_violation';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function public.hero_media_guard() from public, anon, authenticated;
create trigger settings_hero_media_guard
  before insert or update on public.settings
  for each row when (new.key = 'hero_media')
  execute function public.hero_media_guard();

insert into public.settings (key, value, description, updated_by) values (
  'hero_media',
  '{
    "aiLabel": true,
    "home": {"video": "/media/hero/home.mp4", "videoMobile": "/media/hero/home-m.mp4", "poster": "/media/hero/home.avif", "posterMobile": "/media/hero/home-m.avif", "card": "/media/hero/home-card.avif"},
    "tax": {"poster": "/media/hero/tax.avif", "posterMobile": "/media/hero/tax-m.avif", "card": "/media/hero/tax-card.avif"},
    "realestate": {"poster": "/media/hero/realestate.avif", "posterMobile": "/media/hero/realestate-m.avif", "card": "/media/hero/realestate-card.avif"},
    "finance": {"poster": "/media/hero/finance.avif", "posterMobile": "/media/hero/finance-m.avif", "card": "/media/hero/finance-card.avif"},
    "local": {"poster": "/media/hero/local.avif", "posterMobile": "/media/hero/local-m.avif", "card": "/media/hero/local-card.avif"}
  }'::jsonb,
  '히어로 배경 영상·그림 — 홈 화면 전체 배경(영상)·분야 허브 머리 절반 높이(영상 또는 포스터)·홈 분야 카드 그림. 파일은 /media/hero/ 안만. aiLabel은 AI 생성 영상 표시(기본 켜짐). 변환: node scripts/media/build-hero.mjs',
  'migration:20261025000078'
) on conflict (key) do nothing;

create policy settings_public_hero_media on public.settings
  for select to anon, authenticated
  using (key = 'hero_media');
