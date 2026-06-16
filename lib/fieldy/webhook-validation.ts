import type { FieldyWebhookPayload } from "@/lib/fieldy/types";

type ValidFieldyWebhookPayload = FieldyWebhookPayload & {
  conversation: NonNullable<FieldyWebhookPayload["conversation"]> & {
    id: string;
  };
};

type PayloadValidation =
  | {
      ok: true;
      payload: ValidFieldyWebhookPayload;
    }
  | {
      ok: false;
      status: 400 | 422;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateFieldyWebhookPayload(body: unknown): PayloadValidation {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "JSON payload must be an object" };
  }

  if (body.type !== "conversation.processed" || !isRecord(body.conversation)) {
    return {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy event",
    };
  }

  if (typeof body.conversation.id !== "string" || body.conversation.id.length === 0) {
    return {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy event",
    };
  }

  return {
    ok: true,
    payload: body as ValidFieldyWebhookPayload,
  };
}
