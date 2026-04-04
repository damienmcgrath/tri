-- Fix missing column referenced in code but never migrated.
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Conversation-level enhancements for topic classification and memory.
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS topic_classification text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz;

-- Message-level enhancements for citations, proposed changes, and structured content.
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proposed_changes jsonb,
  ADD COLUMN IF NOT EXISTS structured_content jsonb;

-- Cross-conversation memory: summaries for semantic search.
CREATE TABLE IF NOT EXISTS public.conversation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  summary text NOT NULL,
  key_topics text[] DEFAULT '{}',
  key_decisions text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_user
  ON public.conversation_summaries(user_id, created_at DESC);

ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY cs_select ON public.conversation_summaries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY cs_insert ON public.conversation_summaries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY cs_update ON public.conversation_summaries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY cs_delete ON public.conversation_summaries FOR DELETE USING (auth.uid() = user_id);
