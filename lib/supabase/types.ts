export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Row<TColumns> = {
  Row: TColumns;
  Insert: Partial<TColumns>;
  Update: Partial<TColumns>;
};

export type Database = {
  public: {
    Tables: {
      lifelog_owner_config: Row<{
        id: number;
        user_id: string;
        created_at: string;
        updated_at: string;
      }>;
      conversations: Row<{
        id: string;
        user_id: string;
        fieldy_id: string;
        title: string | null;
        summary: string | null;
        content: string | null;
        keywords: string[];
        started_at: string | null;
        ended_at: string | null;
        fieldy_metadata: Json;
        embedding: string | null;
        embedding_model: string | null;
        embedding_input_hash: string | null;
        embedded_at: string | null;
        embedding_error: string | null;
        created_at: string;
        updated_at: string;
      }>;
      transcriptions: Row<{
        id: string;
        user_id: string;
        conversation_id: string;
        fieldy_segment_id: string;
        speaker_label: string | null;
        text: string;
        started_at: string | null;
        ended_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      tasks: Row<{
        id: string;
        user_id: string;
        conversation_id: string | null;
        fieldy_task_id: string;
        title: string;
        status: string;
        due_at: string | null;
        fieldy_metadata: Json;
        created_at: string;
        updated_at: string;
      }>;
      sync_runs: Row<{
        id: string;
        user_id: string;
        source: "webhook" | "backfill";
        status: "running" | "succeeded" | "failed";
        started_at: string;
        finished_at: string | null;
        imported_count: number;
        error_message: string | null;
      }>;
    };
    Views: Record<string, never>;
    Functions: {
      is_lifelog_owner: {
        Args: {
          row_user_id: string;
        };
        Returns: boolean;
      };
      match_conversations: {
        Args: {
          [key: string]: unknown;
          query_embedding: number[];
          match_count?: number;
          match_threshold?: number;
        };
        Returns: Array<{
          id: string;
          title: string | null;
          summary: string | null;
          started_at: string | null;
          ended_at: string | null;
          keywords: string[];
          similarity: number;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
