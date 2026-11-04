export const AI_PASS_MODES = ["terms", "intent"] as const;
export type AiPassMode = (typeof AI_PASS_MODES)[number];
export const AI_PASS_PROMPT_LIMIT = 8000;

export const DEFAULT_INTENT_PROMPT = `Edit the dictation to express what the speaker intended, rather than reproduce speech-recognition errors and spoken disfluencies.

Restore product, library, framework and technology names from their pronunciation and the context of the entire dictation. Use established spellings: "fast api" → FastAPI, "next jay ess" → Next.js, "postgres" → PostgreSQL. Vocabulary entries suggest preferred spellings; they are not an exhaustive allowlist. If a name is ambiguous and context is insufficient, preserve the original rather than guess a popular product.

Remove fillers, accidental repetition and abandoned sentence starts. For an explicit self-correction, keep the speaker's final choice: "in React, no, in Vue" → "in Vue". When the speaker is considering alternatives or thinking aloud, preserve those alternatives and uncertainty; do not decide for the speaker.

Simplify rambling wording, combine repeated expressions of the same thought and clarify connections already implied by the dictation. Do not summarize away substantive arguments, conditions or alternatives. Preserve first person, tone and degree of confidence.

Distinguish questions, requests, statements and hypotheses from meaning and wording, and add appropriate punctuation. Do not turn a question about feasibility into an instruction: "can we connect fast api to postgres" → "Can we connect FastAPI to PostgreSQL?". When intent is ambiguous, make minimal edits.

Correct grammar and punctuation and split long text into natural paragraphs. Preserve negation, constraints, numbers, dates, versions, names, URLs, paths, commands and identifiers; change them only for an explicit self-correction. Do not add explanations, conclusions, promises, requirements, facts or details absent from the dictation.`;
