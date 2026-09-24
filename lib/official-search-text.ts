const SEARCH_TEXT_FIELDS = [
  { column: "sido", jsonKey: "sido" },
  { column: "sigungu", jsonKey: "sigungu" },
  { column: "category", jsonKey: "category" },
  { column: "subcategory", jsonKey: "subcategory" },
  { column: "name", jsonKey: "name" },
  { column: "description", jsonKey: "description" },
  { column: "target", jsonKey: "target" },
  { column: "detail_target", jsonKey: "detailTarget" },
  { column: "application_method", jsonKey: "applicationMethod" },
  { column: "provider", jsonKey: "provider" },
  { column: "type", jsonKey: "type" },
] as const;

function normalizedSearchText(parts: readonly string[]): string {
  const joined = parts.map((part) => `COALESCE(${part}, '')`).join(" || ");
  return `LOWER(REPLACE(REPLACE(REPLACE(${joined}, ' ', ''), char(10), ''), char(9), ''))`;
}

export const SEARCH_TEXT_FROM_COLUMNS = normalizedSearchText(
  SEARCH_TEXT_FIELDS.map((field) => field.column),
);

export const SEARCH_TEXT_FROM_JSON = normalizedSearchText(
  SEARCH_TEXT_FIELDS.map((field) => `json_extract(value, '$.${field.jsonKey}')`),
);

export const SEARCH_TEXT_LOOKUP =
  `CASE WHEN search_text <> '' THEN search_text ELSE ${SEARCH_TEXT_FROM_COLUMNS} END`;
