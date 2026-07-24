import { OpenAPIHono, z } from '@hono/zod-openapi';
import isLocale from 'validator/es/lib/isLocale';
import * as z4 from 'zod/v4';
import { detectLanguage } from '~/lib/detect-language';
import { extractHtmlText, injectHtmlText } from '~/lib/html-translate';
import { generateSingleFieldObject } from '~/lib/repair-single-field-object';
import { resolveModel } from '~/lib/resolve-model';
import detect from '~/routes/language/translate/v2/detect/index';
import languages from '~/routes/language/translate/v2/languages/index';
import type { ContextVariables, EnvVars } from '~/types';
import { Models } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const languageCodeSchema = z.string().trim().nonempty().refine(isLocale, 'must be a valid ISO 639-1 or BCP-47 language code').openapi({ example: 'en' });

/**
 * Translates a single plain-text segment (no markup) from `source` to `target`.
 *
 * Resolves its own model instance (rather than accepting one from the caller) so that every concurrent call -
 * this is invoked in parallel both per `q` item and, in HTML mode, per text node - gets its own instance. Sharing
 * one `resolveModel()` result across concurrent calls corrupts the underlying AI Gateway request (see resolveModel).
 */
async function translateSegment({ text, source, target, modelInput, abortSignal }: { text: string; source: string; target: string; modelInput: { model?: Models; zdr?: boolean }; abortSignal?: AbortSignal }) {
	const output = await generateSingleFieldObject({
		model: resolveModel(modelInput),
		abortSignal,
		system: `You are a professional plain-text translation engine. The source text is in the language with ISO 639-1/BCP-47 code "${source}". Translate it to the language with code "${target}". Preserve the original meaning, tone, register, and whitespace/line breaks exactly. Respond with only the translated text - no explanations, notes, or extra commentary.`,
		prompt: text,
		key: 'translatedText',
		schema: z4.object({
			translatedText: z4.string().trim().meta({ description: 'The translated text, and only the translated text.' }),
		}),
	});

	return output.translatedText;
}

/**
 * Translates an HTML fragment by extracting its text nodes (skipping `<script>`/`<style>` content), translating
 * only that text, and re-inserting it into the original markup - every tag and attribute (`class`, `id`, or
 * otherwise) passes through untouched, since the model never sees them.
 */
async function translateHtml({ html, source, target, modelInput, abortSignal }: { html: string; source: string; target: string; modelInput: { model?: Models; zdr?: boolean }; abortSignal?: AbortSignal }) {
	const originalNodes = await extractHtmlText(html);

	const translatedNodes = await Promise.all(
		originalNodes.map(async (node) => {
			const leading = /^\s*/.exec(node)?.[0] ?? '';
			const rest = node.slice(leading.length);
			const trailing = /\s*$/.exec(rest)?.[0] ?? '';
			const core = rest.slice(0, rest.length - trailing.length);

			// Whitespace-only text nodes (indentation between tags, etc.) aren't worth translating - leave as-is.
			if (!core) {
				return null;
			}

			const translatedCore = await translateSegment({ text: core, source, target, modelInput, abortSignal });
			return `${leading}${translatedCore}${trailing}`;
		}),
	);

	return injectHtmlText(html, translatedNodes);
}

app.openapi(
	{
		method: 'post',
		path: '/',
		description: 'Translates input text, returning translated text.',
		request: {
			query: z.object({
				q: z
					.union([
						z
							.string()
							.trim()
							.nonempty()
							.transform((text) => [text]),
						z.array(z.string().trim()).nonempty().max(128),
					])
					.openapi({
						type: 'array',
						items: { type: 'string', minLength: 1 },
						minItems: 1,
						maxItems: 128,
						description: 'The input text to translate. Provide an array of strings to translate multiple phrases.',
					}),
				target: languageCodeSchema.openapi({ description: 'The language to use for translation of the input text.' }),
				format: z.enum(['html', 'text']).default('text').openapi({ description: 'The format of the source text, in either HTML or plain-text (default). In `html` mode, only text content is translated - tags and attributes (`class`, `id`, etc.) are preserved exactly, and `<script>`/`<style>` contents are left untranslated.' }),
				source: languageCodeSchema.optional().openapi({ description: 'The language of the source text. If the source language is not specified, the API will attempt to detect the source language automatically and return it within the response.' }),
				model: z.enum(Models).optional().openapi({ description: 'The Workers AI model to translate with. Defaults to the gateway-configured model.', default: Models['glm-47-flash'] }),
				zdr: z
					.enum(['true', 'false'])
					.transform((value) => value === 'true')
					.optional()
					.openapi({ description: 'Zero Data Retention (ZDR). When `true`, the upstream AI Gateway request is made with log collection disabled and ZDR enabled.' }),
			}),
		},
		responses: {
			200: {
				description: 'Successful translation.',
				content: {
					'application/json': {
						schema: z.object({
							data: z
								.object({
									translations: z
										.array(
											z
												.object({
													detectedSourceLanguage: languageCodeSchema.optional().openapi({ description: 'The source language of the initial request, detected automatically, if no source language was passed within the initial request. If the source language was passed, auto-detection of the language will not occur and this field will be omitted.' }),
													model: z.enum(Models).openapi({ description: 'The translation model used for the request.' }),
													translatedText: z.string().trim().nonempty().openapi({ description: 'Text translated into the target language.' }),
												})
												.openapi('TranslateTextResponseTranslation'),
										)
										.openapi('TranslateTextResponseList', { description: 'Contains list of translation results of the supplied text.' }),
								})
								.openapi({ description: 'The list of language translation responses. This list contains a language translation response for each query (q) sent in the language translation request.' }),
						}),
					},
				},
			},
			400: {
				description: 'The request was malformed or requested an unsupported feature.',
				content: {
					'application/json': {
						schema: z.object({
							success: z.literal(false),
							errors: z.array(
								z.object({
									message: z.string().trim(),
									extensions: z.object({ code: z.number() }),
								}),
							),
						}),
					},
				},
			},
		},
	},
	async (c) => {
		const input = c.req.valid('query');
		const modelInput = { model: input.model, zdr: input.zdr };

		const translations = await Promise.all(
			input.q.map(async (text) => {
				// Detect off the extracted plain text in HTML mode - raw markup (tags, attributes) is noise for language detection.
				const detectionText = input.format === 'html' ? (await extractHtmlText(text)).join(' ').trim() || text : text;
				const resolvedSource = input.source ?? (await detectLanguage(detectionText, resolveModel(modelInput))).language;

				const translatedText = input.format === 'html' ? await translateHtml({ html: text, source: resolvedSource, target: input.target, modelInput, abortSignal: c.req.raw.signal }) : await translateSegment({ text, source: resolvedSource, target: input.target, modelInput, abortSignal: c.req.raw.signal });

				return {
					translatedText,
					// Only report a detected language when the caller didn't provide one, matching Google's v2 behavior.
					...(!input.source && { detectedSourceLanguage: input.source ? undefined : resolvedSource }),
					model: input.model && input.model !== c.var.modelString ? input.model : c.var.modelString,
				};
			}),
		);

		return c.json({ data: { translations } }, 200);
	},
);

app.route('/detect', detect);
app.route('/languages', languages);

export default app;
