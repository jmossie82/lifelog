import { redirect } from "next/navigation";
import { RecallChat } from "@/components/recall-chat";
import { getOwnerUserId } from "@/lib/env";
import {
  getRecallChatMessages,
  getRecallChatSession,
  getRecallChatSessions,
  normalizeRecallChatSessionId,
} from "@/lib/lifelog/recall-chat-persistence";
import { readFirstSearchParam } from "@/lib/lifelog/conversation-detail-route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  const resolvedSearchParams = await searchParams;
  const selectedChatId = normalizeRecallChatSessionId(
    readFirstSearchParam(resolvedSearchParams.chat),
  );
  const initialSessions = await getRecallChatSessions(supabase, {
    userId: user.id,
  });
  const selectedSession =
    selectedChatId === null
      ? null
      : await getRecallChatSession(supabase, {
          sessionId: selectedChatId,
          userId: user.id,
        });
  const displayedSessions =
    selectedSession !== null &&
    !initialSessions.some((session) => session.id === selectedSession.id)
      ? [selectedSession, ...initialSessions]
      : initialSessions;
  const initialMessages = selectedSession
    ? await getRecallChatMessages(supabase, {
        sessionId: selectedSession.id,
        userId: user.id,
      })
    : [];
  const activeSelectedChatId = selectedSession?.id ?? null;

  return (
    <RecallChat
      key={activeSelectedChatId ?? "new-recall-chat"}
      initialMessages={initialMessages}
      initialSessions={displayedSessions}
      selectedChatId={activeSelectedChatId}
    />
  );
}
