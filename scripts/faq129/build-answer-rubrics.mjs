import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { faq129Rubric } from '../../lib/mcp/faq129-rubric.ts';

const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const db = new DatabaseSync(':memory:');
try {
  db.exec(await readFile(new URL('../../drizzle/0112_faq_129.sql', import.meta.url), 'utf8'));
  const rows = db.prepare('SELECT * FROM faq_129 ORDER BY faq_id').all();
  const cases = rows.map(source => {
    const actual = createHash('sha256').update(source.question + '\n' + source.answer).digest('hex');
    if (actual !== source.content_sha256) throw new Error('FAQ_SOURCE_HASH_MISMATCH:' + source.faq_id);
    return { id: 'FAQ129-' + source.faq_id, question: source.question, reference_answer: source.answer, rubric: faq129Rubric(source) };
  });
  if (cases.length !== 788 || new Set(cases.map(row => row.id)).size !== 788) throw new Error('FAQ_COVERAGE_INCOMPLETE');
  const summary = { total: cases.length, complete_source_paragraphs: cases.every(row => row.rubric.requirements.map(block => block.source_quote).join('\n\n') === row.reference_answer.split(/\r?\n[\t ]*\r?\n+/).filter(text => text.trim()).join('\n\n')),
    mandatory_citations: cases.filter(row => row.rubric.citation_required && row.rubric.written_date_required).length,
    selected_relationships_reviewed: cases.filter(row => row.rubric.semantic_review === 'SELECTED_RELATIONSHIPS_REVIEWED').length,
    unresolved_guidance: cases.filter(row => row.rubric.unresolved.length).length,
    flagged_table_layouts: cases.filter(row => row.rubric.risk_flags.includes('TABLE_LAYOUT_REVIEW_REQUIRED')).length,
    answer_generation: 'NOT_RUN', final_answer_accuracy: 'NOT_EVALUATED', semantic_review: 'NOT_COMPLETED_FOR_ALL_CASES' };
  await writeFile(resolve(output, 'faq129-answer-rubrics-788.json'), JSON.stringify({ generated_at: new Date().toISOString(), summary, cases }, null, 2));
  await writeFile(resolve(output, 'faq129-rubric-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { db.close(); }
