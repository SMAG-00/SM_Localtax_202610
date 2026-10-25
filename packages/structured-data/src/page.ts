/**
 * 페이지 단위 조합 — 페이지 코드는 JSON-LD를 손으로 쓰지 않고 이 함수 하나를 부른다 (OPT-02).
 * 순서: 주 유형 → 추가 유형(동영상 기사의 VideoObject) → BreadcrumbList.
 */
import type { JsonLdNode } from "./jsonld";
import type { PageInput } from "./models";
import type { PageKind } from "./types-map";
import {
  book,
  breadcrumbList,
  collectionPage,
  course,
  dataset,
  event,
  newsArticle,
  newsMediaOrganization,
  profilePage,
  videoObject,
} from "./generators";

type SameSet<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** 입력 종류와 유형 대응표의 키가 같아야 컴파일된다 */
const kindsMatchTypeMap: SameSet<Exclude<PageInput["kind"], "collection">, PageKind> = true;
void kindsMatchTypeMap;

export function pageJsonLd(input: PageInput): JsonLdNode[] {
  const nodes: (JsonLdNode | null)[] = [];
  switch (input.kind) {
    case "article":
      nodes.push(newsArticle(input.article));
      if (input.article.video) nodes.push(videoObject(input.article.video));
      break;
    case "mediaOrganization":
      nodes.push(newsMediaOrganization(input.organization));
      break;
    case "person":
      nodes.push(profilePage(input.person));
      break;
    case "event":
      nodes.push(event(input.event));
      break;
    case "book":
      nodes.push(book(input.book));
      break;
    case "course":
      nodes.push(course(input.course));
      break;
    case "dataset":
      nodes.push(dataset(input.dataset));
      break;
    case "collection":
      nodes.push(collectionPage(input.collection));
      break;
    default: {
      const unknownInput: never = input;
      throw new TypeError(`알 수 없는 페이지 종류: ${JSON.stringify(unknownInput)}`);
    }
  }
  if (input.breadcrumb) nodes.push(breadcrumbList(input.breadcrumb));
  return nodes.filter((n): n is JsonLdNode => n !== null);
}
