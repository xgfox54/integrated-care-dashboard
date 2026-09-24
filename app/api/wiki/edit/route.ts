import { describeError } from "@/lib/errors";
import { readWikiEdit } from "@/lib/wiki-edit-store";
import { publicWikiEdit } from "@/lib/wiki-edits";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const serviceId = new URL(request.url).searchParams.get("serviceId")?.trim() ?? "";
  if (!serviceId || serviceId.length > 120) return Response.json({ edit: null }, { headers: NO_STORE });
  try {
    const edit = await readWikiEdit(serviceId);
    return Response.json({ edit: edit ? publicWikiEdit(edit) : null }, { headers: NO_STORE });
  } catch (error) {
    return Response.json({ edit: null, error: describeError(error) }, { status: 500, headers: NO_STORE });
  }
}
