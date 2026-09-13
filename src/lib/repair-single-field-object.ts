import { generateText, JSONParseError, NoObjectGeneratedError, Output, TypeValidationError } from 'ai';
import type { AiGateway } from 'ai-gateway-provider';
import { jsonrepair } from 'jsonrepair';
import type * as z4 from 'zod/v4';

/**
 * Translation - and the follow-up JSON repair - is a mechanical transformation, not a task that benefits from a
 * chain of thought. Several Workers AI models reason by default and spend the whole request budget doing it:
 * `@cf/google/gemma-4-26b-a4b-it` emitted 2101 reasoning tokens (12.5s) and `@cf/zai-org/glm-5.2` 992 (12.3s)
 * translating a single sentence whose answer is ~30 tokens. Callers give up long before that - `@inlang/cli`
 * aborts at 20s - so the overrun cancels the request outright rather than merely being slow.
 *
 * `enable_thinking` is the chat-template switch the GLM/Qwen-family templates read; `reasoningEffort` is the
 * OpenAI-shaped equivalent (`reasoning_effort`) for models like `@cf/openai/gpt-oss-120b`. Each family ignores
 * the other's knob, so both are sent. Note that the AI SDK's own `reasoning: 'none'` call setting is NOT a
 * substitute: `@ai-sdk/openai-compatible` maps that case to `undefined`, omitting the field entirely, so it is
 * indistinguishable from sending nothing at all.
 *
 * Keyed by `Unified` because `ai-gateway-provider`'s `createUnified()` is `createOpenAICompatible({ name: 'Unified' })`,
 * and `@ai-sdk/openai-compatible` derives its provider-options key from that name. `chat_template_kwargs` is not
 * part of its option schema, so it is forwarded to Workers AI verbatim; `reasoningEffort` is mapped onto
 * `reasoning_effort`. If that package ever renames the provider, these options silently stop applying.
 */
const noThinkingProviderOptions = {
	Unified: {
		chat_template_kwargs: { enable_thinking: false },
		reasoningEffort: 'low',
	},
};

/**
 * Runs `generateText` with a single-string-field structured output schema (via `Output.object`), repairing
 * the model's response if it fails schema validation.
 *
 * `generateText`'s `Output.object()` has no built-in repair hook (unlike the deprecated `generateObject`, which
 * exposes `experimental_repairText`), so failures are repaired manually here: first a cheap structural fix-up
 * (`jsonrepair` + remapping whatever single key the model hallucinated back to the expected one - small models
 * often emit valid JSON with the wrong key name, e.g. `{ translation: "..." }` instead of
 * `{ translatedText: "..." }`), and only if that fails, a follow-up call asking `model` to reformat its own
 * broken output.
 */
export async function generateSingleFieldObject<T extends Record<string, unknown>>({ model, abortSignal, system, prompt, key, schema }: { model: ReturnType<AiGateway['chat']>; abortSignal?: AbortSignal; system: string; prompt: string; key: string; schema: z4.ZodType<T> }) {
	try {
		const { output } = await generateText({
			model,
			abortSignal,
			maxRetries: 0,
			providerOptions: noThinkingProviderOptions,
			system,
			prompt,
			output: Output.object({ schema }),
		});

		return output;
	} catch (error) {
		if (!NoObjectGeneratedError.isInstance(error) || error.text === undefined || !(JSONParseError.isInstance(error.cause) || TypeValidationError.isInstance(error.cause))) {
			throw error;
		}

		const repairedText = await repairText({ text: error.text, key, sourceText: prompt, model, abortSignal, errorMessage: error.message });

		const parsed = repairedText !== null ? safeJsonParse(repairedText) : undefined;
		const result = parsed !== undefined ? schema.safeParse(parsed) : undefined;

		if (!result?.success) {
			throw error;
		}

		return result.data;
	}
}

async function repairText({ text, key, sourceText, model, abortSignal, errorMessage }: { text: string; key: string; sourceText: string; model: ReturnType<AiGateway['chat']>; abortSignal?: AbortSignal; errorMessage: string }) {
	const structural = tryStructuralRepair(text, key, sourceText);
	if (structural) {
		return structural;
	}

	try {
		const { text: rewritten } = await generateText({
			model,
			abortSignal,
			maxRetries: 0,
			providerOptions: noThinkingProviderOptions,
			system: `The following text was supposed to be a single JSON object with exactly one key, "${key}", whose value is a string. It failed to parse with: "${errorMessage}". Return ONLY the corrected JSON object - no commentary, no code fences.`,
			prompt: text,
		});

		return tryStructuralRepair(rewritten, key, sourceText) ?? rewritten.trim();
	} catch {
		return null;
	}
}

/** Repairs JSON syntax with `jsonrepair`, then remaps a hallucinated key to `key` if there's exactly one value to work with. */
function tryStructuralRepair(text: string, key: string, sourceText: string) {
	const parsed = safeJsonParse(jsonrepairSafe(text));
	if (parsed === undefined) {
		return null;
	}

	if (typeof parsed === 'string') {
		return JSON.stringify({ [key]: parsed });
	}

	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const record = parsed as Record<string, unknown>;

		if (typeof record[key] === 'string') {
			return JSON.stringify({ [key]: record[key] });
		}

		const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
		const [entry] = entries;
		if (entries.length === 1 && entry !== undefined) {
			const [entryKey, entryValue] = entry;

			// Some models swap key/value (e.g. `{ "Salut Lume": "Hello World" }`): if the value is just the
			// source text echoed back and the key doesn't look like a field name, the answer is in the key.
			if (isEcho(entryValue, sourceText) && !looksLikeFieldName(entryKey)) {
				return JSON.stringify({ [key]: entryKey });
			}

			return JSON.stringify({ [key]: entryValue });
		}
	}

	return null;
}

function isEcho(value: string, sourceText: string) {
	return value.trim().toLowerCase() === sourceText.trim().toLowerCase();
}

function looksLikeFieldName(value: string) {
	return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim());
}

function jsonrepairSafe(text: string) {
	try {
		return jsonrepair(text);
	} catch {
		return text;
	}
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
