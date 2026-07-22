import type { LanguageModelV3 } from '@ai-sdk/provider';
import { francAll } from 'franc-all';
import { getContext } from 'hono/context-storage';
import { iso6393To1 } from 'iso-639-3';
import isLocale from 'validator/es/lib/isLocale';
import * as z4 from 'zod/v4';
import { generateSingleFieldObject } from '~/lib/repair-single-field-object';
import type { ContextVariables, EnvVars } from '~/types';

export interface LanguageDetectionResult {
	language: string;
	confidence: number;
}

/**
 * Best-effort language detection via `franc`. Returns every recognized candidate (best match first), or an empty
 * array when none could be determined confidently. `franc` identifies languages by their ISO 639-3 code; since not
 * every ISO 639-3 language has an ISO 639-1 equivalent, we downgrade to the ISO 639-3 code (still a valid BCP-47
 * primary language subtag) when no ISO 639-1 mapping exists.
 */
function detectAllWithFranc(text: string): LanguageDetectionResult[] {
	try {
		return francAll(text)
			.filter((tuple): tuple is [string, number] => tuple[0] !== 'und')
			.map(([code, confidence]) => ({ language: iso6393To1[code] ?? code, confidence }));
	} catch {
		// Fall through to LLM-based detection.
		return [];
	}
}

async function detectWithModel(text: string, model: LanguageModelV3): Promise<LanguageDetectionResult> {
	const { req } = getContext<{ Bindings: EnvVars; Variables: ContextVariables }>();
	const output = await generateSingleFieldObject({
		model,
		abortSignal: req.raw.signal,
		system: 'You are a language identification engine. Identify the language the given text is written in and respond with only its ISO 639-1 (or, if unavailable, BCP-47) language code.',
		prompt: text,
		key: 'language',
		schema: z4.object({
			language: z4.string().trim().refine(isLocale, 'must be a valid ISO 639-1 or BCP-47 language code').meta({ description: 'The ISO 639-1 (or BCP-47) code of the language the text is written in.' }),
		}),
	});

	return { language: output.language, confidence: 1 };
}

/** Detects the ISO 639-1 (or BCP-47) language code of `text`, using `franc` first and falling back to `model` when franc can't determine one confidently. Returns only the top candidate. */
export async function detectLanguage(text: string, model: LanguageModelV3): Promise<LanguageDetectionResult> {
	const [topFrancDetected] = detectAllWithFranc(text);

	if (topFrancDetected) {
		return topFrancDetected;
	}

	return detectWithModel(text, model);
}

/** Detects every ISO 639-1 (or BCP-47) language candidate `franc` can find for `text` (best match first), falling back to a single `model`-detected candidate when franc can't determine any confidently. */
export async function detectLanguageCandidates(text: string, model: LanguageModelV3): Promise<LanguageDetectionResult[]> {
	const francDetected = detectAllWithFranc(text);

	if (francDetected.length > 0) {
		return francDetected;
	}

	return [await detectWithModel(text, model)];
}
