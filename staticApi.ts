import { createWriteStream } from 'node:fs';
import { unstable_startWorker } from 'wrangler';

const openapiVersions = [
	// Get the OpenAPI versions
	'openapi',
	'openapi31',
	'translate.cf-apig.openapi',
];

console.info({ openapiVersions });

await unstable_startWorker({
	config: 'wrangler.jsonc',
	build: {
		minify: true,
		keepNames: false,
		nodejsCompatMode: 'v1',
	},
	dev: {
		inspector: false,
		liveReload: false,
		watch: false,
	},
}).then((worker) =>
	Promise.allSettled([
		// Get each OpenAPI version
		...openapiVersions.map(async (oV) => {
			const url = new URL(['generate', oV].join('/'), (await worker.url).origin);
			console.info(new Date().toISOString(), 'GET', url.toString(), `${url.pathname}${url.search}${url.hash}`);

			await worker.ready;

			const response = await worker.fetch(url.toString());

			console.info(new Date().toISOString(), response.status, `${url.pathname}${url.search}${url.hash}`);

			if (response.ok && response.body) {
				/**
				 * Write the file to the asset directory
				 * Use streaming to optimize memory usage
				 */
				const writeStream = createWriteStream(['dist', `${oV}.json`].join('/'), { encoding: 'utf-8' });

				for await (const chunk of response.body) {
					writeStream.write(chunk);
				}

				writeStream.end();

				console.log('Wrote', 'OpenAPI', oV === '' ? '30' : oV, 'to', response.status);
			}
		}),
	]).finally(() => worker.dispose()),
);

process.exit(0);
