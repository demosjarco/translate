import type { AiGateway } from 'ai-gateway-provider';
import type { TimingVariables } from 'hono/timing';

export interface EnvVars extends Omit<Cloudflare.Env, ''>, TypedBindings {
	GIT_HASH?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TypedBindings {}

export interface ContextVariables extends TimingVariables {
	modelString: Models;
	modelGateway: AiGateway;
	model: ReturnType<AiGateway['chat']>;
}

export enum Models {
	'glm-52' = '@cf/zai-org/glm-5.2',
	'glm-47-flash' = '@cf/zai-org/glm-4.7-flash',
	'gemma-4-26b-a4b-it' = '@cf/google/gemma-4-26b-a4b-it',
	'gpt-oss-120b' = '@cf/openai/gpt-oss-120b',
}
