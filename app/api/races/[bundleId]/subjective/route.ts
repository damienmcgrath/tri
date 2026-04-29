import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import {
  persistSubjectiveInput,
  subjectiveInputSchema
} from "@/lib/race/subjective-input";

export async function POST(request: Request, context: { params: Promise<{ bundleId: string }> }) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { bundleId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = subjectiveInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subjective input.", issues: parsed.error.flatten() }, { status: 422 });
  }

  const result = await persistSubjectiveInput({
    supabase,
    userId: user.id,
    bundleId,
    input: parsed.data
  });

  if (result.status === "error") {
    const httpStatus = result.reason === "bundle_not_found" ? 404 : 500;
    return NextResponse.json({ error: result.reason }, { status: httpStatus });
  }

  revalidatePath(`/races/${bundleId}`);
  revalidatePath(`/races/${bundleId}/notes`);
  return NextResponse.json({ ok: true, bundleId });
}
