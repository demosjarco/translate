import { OpenAPIHono } from '@hono/zod-openapi';
import translate from '~/routes/language/translate/index';
import type { ContextVariables, EnvVars } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

app.route('/translate', translate);

export default app;
