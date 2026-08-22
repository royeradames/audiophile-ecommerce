import { stripePublicConfig } from "../../../stripe-env";

export async function GET() {
  return Response.json(stripePublicConfig());
}
