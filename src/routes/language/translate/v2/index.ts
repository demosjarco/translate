import { OpenAPIHono, z } from '@hono/zod-openapi';
import isLocale from 'validator/es/lib/isLocale';
import * as z4 from 'zod/v4';
import { detectLanguage } from '~/lib/detect-language';
import { generateSingleFieldObject } from '~/lib/repair-single-field-object';
import { resolveModel } from '~/lib/resolve-model';
import detect from '~/routes/language/translate/v2/detect/index';
import languages from '~/routes/language/translate/v2/languages/index';
import type { ContextVariables, EnvVars } from '~/types';
import { Models } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const languageCodeSchema = z.string().trim().nonempty().refine(isLocale, 'must be a valid ISO 639-1 or BCP-47 language code').openapi({ example: 'en' });

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
				format: z
					// .enum(['html', 'text'])
					.enum(['text'])
					// .default('html')
					.default('text')
					.openapi({ description: 'The format of the source text, in either HTML (default) or plain-text. A value of `html` indicates HTML and a value of `text` indicates plain-text' }),
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

		// if (input.format === 'html') {
		// 	return c.json({ success: false as const, errors: [{ message: '`format=html` is not yet supported; use `format=text`.', extensions: { code: 400 } }] }, 400);
		// }

		const model = resolveModel({ model: input.model, zdr: input.zdr });

		const translations = await Promise.all(
			input.q.map(async (text) => {
				const resolvedSource = input.source ?? (await detectLanguage(text, model)).language;
				const output = await generateSingleFieldObject({
					model,
					abortSignal: c.req.raw.signal,
					system: `You are a professional plain-text translation engine. The source text is in the language with ISO 639-1/BCP-47 code "${resolvedSource}". Translate it to the language with code "${input.target}". Preserve the original meaning, tone, register, and whitespace/line breaks exactly. Respond with only the translated text - no explanations, notes, or extra commentary.`,
					prompt: text,
					key: 'translatedText',
					schema: z4.object({
						translatedText: z4.string().trim().meta({ description: 'The translated text, and only the translated text.' }),
					}),
				});

				return {
					translatedText: output.translatedText,
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
