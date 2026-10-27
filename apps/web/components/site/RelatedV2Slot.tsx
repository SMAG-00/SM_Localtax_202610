import type { ArticleRef } from "@/lib/law/article-ref";
import { getRelatedV2 } from "@/lib/server/public/law-v2";
import { hasEntitlementKey } from "@/lib/server/billing/service";
import { currentUserId } from "@/lib/server/library/read";
import { readPublicSettings } from "@/lib/server/public/reads";
import { adminClient } from "@/lib/server/supabase";
import type { PanelItemV2 } from "@/lib/law/panel-v2";
import { RelatedPanelV2 } from "./RelatedPanelV2";

// 조문 화면의 관련 자료 v2 (LAW-10). v1 패널이 보이는 판례·심판·해석·기사 위에, v2에서 새로 생기는 지식창고·월간지·유사도 추천 카드를 같은 카드 문법으로 더한다.
// 본문은 싣지 않는다. 읽기에 실패하면 v1 패널만 남도록 아무것도 그리지 않는다.
export async function RelatedV2Slot({ lawId, refArticle, searchHref }: { lawId: number; refArticle: ArticleRef; searchHref: string }) {
  let extra: PanelItemV2[] = [];
  let splitOn = false;
  try {
    const userId = await currentUserId().catch(() => null);
    const db = adminClient();
    const entitled = userId && db ? await hasEntitlementKey(db, userId, "library").catch(() => false) : false;
    const all = await getRelatedV2(lawId, refArticle, entitled);
    extra = all.filter((i) => i.kind === "node" || i.kind === "issue_article" || i.origin === "similarity");
    splitOn = (await readPublicSettings()).features.law_split;
  } catch {
    return null;
  }
  if (extra.length === 0) return null;
  return (
    <div data-part="related-v2" className="mt-4">
      <RelatedPanelV2 items={extra} searchHref={searchHref} splitBase={splitOn ? "/workspace/split?p=" : null} />
    </div>
  );
}
