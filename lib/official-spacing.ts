import correctionData from "../data/official-spacing-corrections.json" with { type: "json" };
import type { OfficialService } from "./official-source.ts";

type SpacingField = "name" | "description";

interface SpacingCorrections {
  readonly version: number;
  readonly method: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description: Readonly<Record<string, string>>;
}

const CORRECTIONS = correctionData as SpacingCorrections;

function normalizeSpacing(value: string, field: SpacingField): string {
  const source = value.replace(/\s+/g, " ").trim();
  return CORRECTIONS[field][source] ?? source;
}

export function repairExtractionSpacing(
  services: readonly OfficialService[],
): readonly OfficialService[] {
  return services.map((service) => ({
    ...service,
    name: normalizeSpacing(service.name, "name"),
    description: normalizeSpacing(service.description, "description"),
  }));
}
