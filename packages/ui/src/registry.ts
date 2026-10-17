// 1단계 컴포넌트 전체 목록 — PRD-00 8.6 단계 칸 1인 70종 (DS-02). /_design 견본과 대조한다
import { registry as base } from "./components/base.registry";
import { registry as shell } from "./components/shell/registry";
import { registry as discovery } from "./components/discovery/registry";
import { registry as local } from "./components/local/registry";
import { registry as services } from "./components/services/registry";

export const componentRegistry = [...base, ...shell, ...discovery, ...local, ...services];
