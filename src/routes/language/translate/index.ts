import { OpenAPIHono } from '@hono/zod-openapi';
import v2 from '~/routes/language/translate/v2/index';
import type { ContextVariables, EnvVars } from '~/types';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

app.route('/v2', v2);

export default app;
