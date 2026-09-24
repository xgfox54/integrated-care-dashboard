import type { OfficialService } from "./official-source.ts";

function identity(service: Pick<OfficialService, "sido" | "sigungu" | "name">): string {
  return [service.sido, service.sigungu, service.name]
    .map((value) => value.toLowerCase().replace(/[^0-9가-힣a-z]/g, ""))
    .join("|");
}

export function enrichWithPublicApi(
  services: readonly OfficialService[],
  apiServices: readonly OfficialService[],
): { readonly services: readonly OfficialService[]; readonly matches: number } {
  const byIdentity = new Map<string, OfficialService | null>();
  for (const service of apiServices) {
    const key = identity(service);
    byIdentity.set(key, byIdentity.has(key) ? null : service);
  }
  let matches = 0;
  const enriched = services.map((service) => {
    const api = byIdentity.get(identity(service));
    if (!api) return service;
    matches += 1;
    return {
      ...service,
      description: service.description || api.description,
      target: service.target || api.target,
      detailTarget: service.detailTarget || api.detailTarget,
      applicationMethod: service.applicationMethod || api.applicationMethod,
      provider: service.provider || api.provider,
      detailUrl: service.detailUrl || api.detailUrl,
      updatedDate: service.updatedDate || api.updatedDate,
    };
  });
  return { services: enriched, matches };
}
