"use client";

import { usePathname } from "next/navigation";
import { staticTrail, trailJsonLd } from "@/lib/site/breadcrumb-trail";
import { JsonLd } from "./JsonLd";

/** 고정 주소의 경로 표시 데이터 — 화면 틀(layout)에 한 번만 둔다. 서버 렌더에서도 현재 주소를 읽어 HTML에 들어간다 (JS를 꺼도 보인다) */
export function PathBreadcrumbJsonLd({ site }: { site: string | undefined }) {
  const trail = staticTrail(usePathname() ?? "");
  return <JsonLd content={trail ? trailJsonLd(trail, site) : null} part="breadcrumb-jsonld" />;
}
