import type { FieldyWebhookPayload } from "@/lib/fieldy/types";

type PayloadValidation =
  | {
      ok: true;
      payload: FieldyWebhookPayload;
    }
  | {
      ok: false;
      status: 400 | 422;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSegment(value: unknown) {
  if (!isRecord(value)) return false;

  return (
    typeof value.text === "string" &&
    typeof value.speaker === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.duration === "number"
  );
}

export function validateFieldyWebhookPayload(body: unknown): PayloadValidation {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "JSON payload must be an object" };
  }

  if (
    typeof body.date !== "string" ||
    typeof body.transcription !== "string" ||
    !Array.isArray(body.transcriptions) ||
    body.transcriptions.length === 0 ||
    !body.transcriptions.every(isValidSegment)
  ) {
    return {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy webhook payload",
    };
  }

  return {
    ok: true,
    payload: body as FieldyWebhookPayload,
  };
}
