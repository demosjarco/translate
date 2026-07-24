import { OpenAPIHono, z } from '@hono/zod-openapi';
import validator from 'validator';
import { detectLanguageCandidates } from '~/lib/detect-language';
import type { ContextVariables, EnvVars } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

app.openapi(
	{
		method: 'post',
		path: '/',
		description: 'Detects the language of text within a request.',
		request: {
			query: z.object({
				q: z
					.union([
						z
							.string()
							.trim()
							.transform((text) => [text]),
						z.array(z.string().trim()).min(1),
					])
					.openapi({
						type: 'array',
						items: { type: 'string' },
						minItems: 1,
						description: 'The input text upon which to perform language detection. Repeat this parameter to perform language detection on multiple text inputs.',
					}),
				zdr: z
					.enum(['true', 'false'])
					.transform((value) => value === 'true')
					.optional()
					.openapi({ type: 'string', enum: ['true', 'false'], description: 'Zero Data Retention (ZDR). When `true`, the upstream AI Gateway request is made with log collection disabled (`cf-aig-collect-log: false`) and ZDR enabled (`cf-aig-zdr: true`).' }),
			}),
		},
		responses: {
			200: {
				description: 'Successful language detection.',
				content: {
					'application/json': {
						schema: z.object({
							data: z
								.object({
									detections: z
										.array(
											z.array(
												z.object({
													language: z.string().trim().refine(validator.isLocale, 'must be a valid ISO 639-1 or BCP-47 language code').openapi({ description: 'The detected language.' }),
													isReliable: z.boolean().openapi({ deprecated: true, description: 'Indicates whether the language detection result is reliable.' }),
													confidence: z.number().nonnegative().max(1).openapi({ deprecated: true, description: 'The confidence of the detection result for this language.' }),
												}),
											),
										)
										.openapi('DetectLanguageResponseList', { description: 'Language detection results for each input text piece.' }),
								})
								.openapi({ description: 'The list of language detection responses. This list will contain a language detection response for each query (q) sent in the language detection request.' }),
						}),
					},
				},
			},
		},
	},
	async (c) => {
		const input = c.req.valid('query');

		const detections = await Promise.all(
			input.q.map(async (text) => {
				const candidates = await detectLanguageCandidates(text, c.var.model);

				return candidates.map(({ language, confidence }) => ({ language, confidence, isReliable: false }));
			}),
		);

		return c.json({ data: { detections } }, 200);
	},
);

export default app;
