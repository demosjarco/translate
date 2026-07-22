import type { LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { getContext } from 'hono/context-storage';
import { setMetric } from 'hono/timing';
import type { ContextVariables, EnvVars } from '~/types';

const timingMiddleware: LanguageModelV3Middleware = {
	specificationVersion: 'v3',
	async wrapGenerate({ doGenerate, model }) {
		const c = getContext<{ Bindings: EnvVars; Variables: ContextVariables }>();
		const start = performance.now();

		try {
			return await doGenerate();
		} finally {
			setMetric(c, 'ai', performance.now() - start, model.modelId);
		}
	},
};

/** Wraps `model` so every `doGenerate` call it makes is reported as a Server-Timing metric via `hono/timing`. */
export function withTiming(model: LanguageModelV3): LanguageModelV3 {
	return wrapLanguageModel({ model, middleware: timingMiddleware });
}
