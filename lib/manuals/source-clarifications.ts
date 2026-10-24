import catalog from '../../data/manual-source-clarifications.json' with { type: 'json' };

export function manualSourceClarifications(documentId: string, parsedHash: string, sectionId: string, sectionHash: string) {
  return catalog.filter(item => item.document_id === documentId && item.parsed_sha256 === parsedHash
    && item.sections.some(section => section.section_id === sectionId && section.section_content_sha256 === sectionHash));
}
