// 매체 소개(/about)의 NewsMediaOrganization (OPT-02) — 이름은 운영 주체 SM(선명), 사이트 이름은 alternateName. 순수 모듈.
//  · 정책 페이지 주소는 지금 열려 있는 것(바닥글 링크에 있는 것)만 단다 — 닫힌 정책 페이지를 가리키지 않는다.
import { brand } from "@ltr/ui";
import { newsMediaOrganization, toJsonLdScriptContent, type NewsMediaPolicies } from "@ltr/structured-data";

const POLICY_FIELDS: ReadonlyArray<readonly [string, keyof NewsMediaPolicies]> = [
  ["/about/editorial-policy", "publishingPrinciples"],
  ["/about/ethics", "ethicsPolicy"],
  ["/about/corrections", "correctionsPolicy"],
];

export function aboutOrganizationJsonLd(site: string | undefined, openPolicyHrefs: readonly string[]): string | null {
  if (!site) return null;
  const policies: NewsMediaPolicies = {};
  for (const [href, field] of POLICY_FIELDS) if (openPolicyHrefs.includes(href)) policies[field] = `${site}${href}`;
  return toJsonLdScriptContent([
    newsMediaOrganization({ name: brand.operatorName, alternateName: brand.productName, url: `${site}/`, ...(Object.keys(policies).length > 0 ? { policies } : {}) }),
  ]);
}
