import { OpenAPIHono, z } from '@hono/zod-openapi';
import { iso6393, iso6393To1 } from 'iso-639-3';
import isISO6391 from 'validator/es/lib/isISO6391';
import isLocale from 'validator/es/lib/isLocale';
import type { ContextVariables, EnvVars } from '~/types';
import { Models } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const namesByCode3 = new Map(iso6393.map((entry) => [entry.iso6393, entry.name]));

// Every ISO 639-1-having language, in code order. Names are always English for now - no localized name data is wired up yet.
const supportedLanguages: { language: string; name: string }[] = Object.entries(iso6393To1)
	.map(([code3, code1]) => ({ language: code1, name: namesByCode3.get(code3) }))
	.filter((entry): entry is { language: string; name: string } => entry.name !== undefined)
	.sort((a, b) => a.language.localeCompare(b.language));

app.openapi(
	{
		method: 'get',
		path: '/',
		description: 'Returns a list of supported languages for translation.',
		request: {
			query: z.object({
				target: z.string().trim().nonempty().refine(isLocale, 'must be a valid ISO 639-1 or BCP-47 language code').optional().openapi({ description: 'The target language code for the results. If specified, then the language names are returned in the `name` field of the response, localized in the target language. If you do not supply a target language, then the `name` field is omitted from the response and only the language codes are returned.' }),
				model: z.enum(Models).optional().openapi({ description: 'The supported languages for a particular translation model.' }),
			}),
		},
		responses: {
			200: {
				description: 'The supported languages.',
				content: {
					'application/json': {
						schema: z.object({
							data: z
								.object({
									languages: z
										.array(
											z
												.object({
													language: z.string().trim().refine(isISO6391, 'must be a valid ISO 639-1 language code').openapi({ description: "Supported language code, generally consisting of its ISO 639-1 identifier. (E.g. 'en', 'ja'). In certain cases, BCP-47 codes including language + region identifiers are returned (e.g. 'zh-TW' and 'zh-CH')" }),
													name: z.string().trim().optional().openapi({ description: 'Human readable name of the language localized to the target language.' }),
												})
												.openapi('GetSupportedLanguagesResponseLanguage'),
										)
										.openapi('GetSupportedLanguagesResponseList', { description: 'The set of supported languages.' }),
								})
								.openapi({ description: 'A list of supported language responses. This list will contain an entry for each language supported by the Translation API.' }),
						}),
					},
				},
			},
		},
	},
	(c) => {
		const { target } = c.req.valid('query');

		return c.json({ data: { languages: target ? supportedLanguages : supportedLanguages.map(({ language }) => ({ language })) } }, 200);
	},
);

export default app;
