import { storeFeatures } from "../../../server/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(storeFeatures(), { headers: { "cache-control": "no-store" } });
}
