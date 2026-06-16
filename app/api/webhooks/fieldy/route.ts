import { type NextRequest, NextResponse } from "next/server";
import { validateFieldyWebhookPayload } from "@/lib/fieldy/webhook-validation";

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!process.env.FIELDY_WEBHOOK_TOKEN) {
    return NextResponse.json(
      { error: "FIELDY_WEBHOOK_TOKEN is not configured" },
      { status: 500 },
    );
  }

  if (token !== process.env.FIELDY_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const validation = validateFieldyWebhookPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }

  return NextResponse.json({
    accepted: true,
    transcriptionDate: validation.payload.date,
    segments: validation.payload.transcriptions.length,
    queued: ["conversation", "transcriptions", "tasks"],
  });
}
