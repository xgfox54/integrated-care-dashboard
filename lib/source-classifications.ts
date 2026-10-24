import { z } from 'zod';
import reviewed from '../data/source-classification-restorations.json' with { type: 'json' };

const changeSchema = z.object({ before: z.string(), value: z.string().min(1) }).readonly();
const sourceSchema = z.object({ revision: z.string(), rows: z.record(z.string(), z.object({ name: z.string().min(1), updated_date: z.string().min(1), fields: z.object({ type: changeSchema.optional(), subcategory: changeSchema.optional() }).strict() })) });
const registry = sourceSchema.parse(reviewed);
export const SOURCE_CLASSIFICATION_REVISION = registry.revision;

type Identity = { readonly serviceId: string; readonly name: string; readonly updatedDate: string };
type Fields = { readonly type: string; readonly subcategory: string };

export function reviewedClassificationOf(row: Identity) {
  const entry = registry.rows[row.serviceId];
  return entry?.name === row.name && entry.updated_date === row.updatedDate ? entry.fields : undefined;
}

export function restoreReviewedClassifications<T extends Identity & Fields>(row: T): T {
  const fields = reviewedClassificationOf(row);
  if (!fields) return row;
  const type = fields.type && (row.type === fields.type.before || row.type === fields.type.value) ? fields.type.value : row.type;
  const subcategory = fields.subcategory && (row.subcategory === fields.subcategory.before || row.subcategory === fields.subcategory.value) ? fields.subcategory.value : row.subcategory;
  return type === row.type && subcategory === row.subcategory ? row : { ...row, type, subcategory };
}
