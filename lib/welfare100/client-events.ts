export type EventProperties = Record<string, string | number | boolean | null | undefined>;

/** The dashboard does not collect analytics; keep the call sites from the original components. */
export function trackEvent(name: string, properties: EventProperties = {}) {
  void name;
  void properties;
}

