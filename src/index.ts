import { createAiGateway } from 'ai-gateway-provider';
import { createUnified } from 'ai-gateway-provider/providers/unified';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { etag } from 'hono/etag';
import { timing, wrapTime } from 'hono/timing';
import { withTiming } from '~/lib/timed-model';
import apiApp from '~/routes/index';
import type { ContextVariables, EnvVars } from './types';
import { Models } from './types';

const app = new Hono<{ Bindings: EnvVars; Variables: ContextVariables }>();
// // Variable storage backend setup
app.use('*', contextStorage());
// Debug
app.use('*', timing());

// Variable Setup
app.use('*', async (c, next) => {
	c.set(
		'modelString',
		(await wrapTime(
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			c,
			'model-flag-fetch',
			c.env.FLAGS.getStringValue('model', '@cf/zai-org/glm-4.7-flash'),
		)) as Models,
	);
	c.set(
		'modelGateway',
		createAiGateway({
			binding: c.env.AI.gateway('translate'),
			resume: {
				binding: c.env.AI,
				gateway: 'translate',
			},
		}),
	);
	c.set(
		'model',
		withTiming(
			c.var.modelGateway([
				createUnified({ supportsStructuredOutputs: true })(`workers-ai/${c.var.modelString}`),
				...Object.values(Models)
					.filter((model) => model !== c.var.modelString)
					.map((model) => createUnified({ supportsStructuredOutputs: true })(`workers-ai/${model}`)),
			]),
		),
	);

	await next();
});

// Security
app.use(
	'*',
	cors({
		origin: '*',
		maxAge: 300,
	}),
);

// Performance
app.use('*', etag());
// Measured in kb
app.use(
	'*',
	bodyLimit({
		maxSize: 100 * 1024,
		onError: (c) => c.json({ success: false, errors: [{ message: 'Content size not supported', extensions: { code: 413 } }] }, 413),
	}),
);

app.route('/', apiApp);

export default app;
