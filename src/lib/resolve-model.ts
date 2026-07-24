import { createAiGateway } from 'ai-gateway-provider';
import { createUnified } from 'ai-gateway-provider/providers/unified';
import { getContext } from 'hono/context-storage';
import { withTiming } from '~/lib/timed-model';
import type { ContextVariables, EnvVars } from '~/types';
import { Models } from '~/types';

/** Builds the flag-selected model followed by every other `Models` entry, in gateway-fallback order. */
export function buildModelList(modelString: Models) {
	return [
		createUnified({ supportsStructuredOutputs: true })(`workers-ai/${modelString}`),
		...Object.values(Models)
			.filter((model) => model !== modelString)
			.map((model) => createUnified({ supportsStructuredOutputs: true })(`workers-ai/${model}`)),
	];
}

/**
 * Resolves the language model to use for a single call: honors a per-request `model` override, and - since Zero
 * Data Retention is a gateway-level option baked in at gateway-construction time, not a per-call one - builds
 * a dedicated ZDR-enabled AI Gateway for this request when `zdr` is requested, rather than reusing the shared,
 * non-ZDR gateway set up in the request middleware.
 *
 * Always constructs a fresh model instance (cheap - pure object construction, no I/O) rather than sharing one
 * across calls: `AiGatewayChatLanguageModel` (from `ai-gateway-provider`) mutates shared state on its underlying
 * provider models while resolving each `doGenerate`/`doStream` call, so two concurrent calls against the *same*
 * instance race and corrupt each other's request bodies. Callers that fire off concurrent model calls (e.g. via
 * `Promise.all`) MUST call this once per call, not once and share the result.
 */
export function resolveModel({ model, zdr }: { model?: Models; zdr?: boolean }) {
	const c = getContext<{ Bindings: EnvVars; Variables: ContextVariables }>();

	const gateway = zdr
		? createAiGateway({
				binding: c.env.AI.gateway('translate'),
				resume: {
					binding: c.env.AI,
					gateway: 'translate',
				},
				options: { collectLog: false, zdr: true },
			})
		: c.var.modelGateway;

	if (model && model !== c.var.modelString) {
		return withTiming(gateway(createUnified({ supportsStructuredOutputs: true })(`workers-ai/${model}`)));
	}

	return withTiming(gateway(buildModelList(c.var.modelString)));
}
