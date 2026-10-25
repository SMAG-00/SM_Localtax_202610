-- W10-e e7 - 새 해석 문서 알림 (PRD-02 TX-12, docs/dev/W10-e_설계.md 4장 #12)
-- · alert_deliveries.delivery_kind에 legal_doc_alert를 더한다 (같은 (동의, 종류, 참조) 유일 규칙).
-- · legal_doc_alert_pending(p_today) - 공개 뷰 public_legal_docs(W10-d 마이그레이션 90 - 스냅샷·권리·이용 조건·공개 보류·기능 키 case_db를 이미 통과한 문서)에서
--   최근 7일 안에 읽을 글자 확인(checked_on)이 된 문서. 공개되지 않은 문서는 뷰에 없으므로 알림 대상이 될 수 없다.
-- · legal_doc_alert_recipients(p_doc_id, p_today) - 문서 알림을 켠(include_docs) 확인된 미철회 알림 구독자. 관심 세목을 고르지 않았으면 모든 문서, 골랐으면 문서 세목과 겹칠 때.
--   [확인 필요: 문서 세목(tax_kinds) 어휘와 구독 화면의 분야 slug 일치 여부 - W10-d 편집자 확인]
-- service_role만 실행한다.

alter table public.alert_deliveries drop constraint alert_deliveries_delivery_kind_check;
alter table public.alert_deliveries add constraint alert_deliveries_delivery_kind_check
  check (delivery_kind in ('brief_issue', 'amendment_alert', 'reconfirm', 'prereg_notice', 'legal_doc_alert'));

create function public.legal_doc_alert_pending(p_today date) returns table (doc_id bigint)
language sql
stable
set search_path = ''
as $$
  select d.id from public.public_legal_docs d where d.checked_on >= p_today - 7 and d.checked_on <= p_today order by d.id;
$$;

create function public.legal_doc_alert_recipients(p_doc_id bigint, p_today date) returns table (consent_id bigint, email text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.email
    from public.public_legal_docs d
    join public.consents c on c.kind = 'amendment_alert' and c.email is not null and c.confirmed_at is not null and c.revoked_at is null
                          and (c.reconfirm_due is null or c.reconfirm_due >= p_today)
    join public.subscriber_prefs p on p.consent_id = c.id and p.include_docs
   where d.id = p_doc_id
     and (cardinality(p.tax_kinds) = 0 or p.tax_kinds && coalesce(d.tax_kinds, '{}'::text[]))
     and not exists (select 1 from public.alert_deliveries a where a.consent_id = c.id and a.delivery_kind = 'legal_doc_alert' and a.ref = p_doc_id::text and a.status = 'sent')
   order by c.id;
$$;

revoke all on function public.legal_doc_alert_pending(date) from public, anon, authenticated;
revoke all on function public.legal_doc_alert_recipients(bigint, date) from public, anon, authenticated;
grant execute on function public.legal_doc_alert_pending(date) to service_role;
grant execute on function public.legal_doc_alert_recipients(bigint, date) to service_role;
