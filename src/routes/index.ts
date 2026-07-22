import { OpenAPIHono } from '@hono/zod-openapi';
import type { oas31 } from 'openapi3-ts';
import language from '~/routes/language/index';
import type { ContextVariables, EnvVars } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const title = 'Translation API' as const;
const description = 'Drop in replacement for Google Cloud Translate API v2 using Workers AI' as const;
const contact: oas31.ContactObject = {
	name: 'Issues',
	url: new URL('https://github.com/demosjarco/translate/issues').toString(),
} as const;
const license: oas31.LicenseObject = {
	name: 'MIT',
	url: new URL('https://opensource.org/licenses/MIT').toString(),
} as const;

app.doc31('/generate/openapi31', (c) => ({
	openapi: '3.1.0',
	info: {
		title,
		version: '',
		contact,
		description,
		license,
		termsOfService: new URL('https://github.com/demosjarco/translate/blob/main/TERMS.md').toString(),
	},
	servers: [
		{
			url: c.req.path
				.split('/')
				.splice(0, c.req.path.split('/').length - 2)
				.join('/'),
		},
	],
}));
app.doc('/generate/openapi', (c) => ({
	openapi: '3.0.0',
	info: {
		title,
		version: '',
		contact,
		description,
		license,
		termsOfService: new URL('https://github.com/demosjarco/translate/blob/main/TERMS.md').toString(),
	},
	servers: [
		{
			url: c.req.path
				.split('/')
				.splice(0, c.req.path.split('/').length - 2)
				.join('/'),
		},
	],
}));
app.doc('/generate/translate.cf-apig.openapi', (c) => ({
	openapi: '3.0.0',
	info: {
		title,
		version: '',
		contact,
		description,
		license,
		termsOfService: new URL('https://github.com/demosjarco/translate/blob/main/TERMS.md').toString(),
	},
	servers: [
		{
			url: 'https://translate.demosjarco.dev',
		},
	],
}));

app.route('/language', language);

export default app;
