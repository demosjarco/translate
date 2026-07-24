import { decode } from 'he';

/**
 * Splits an HTML fragment apart from its text so translation only ever touches actual text content, never
 * markup: `extractHtmlText` walks the fragment with `HTMLRewriter` (the runtime's own HTML5 parser) and returns
 * every text node's decoded text in document order, and `injectHtmlText` walks it again to swap those text nodes
 * for replacements at the same positions. Because `HTMLRewriter` operates on tokens rather than re-serializing a
 * DOM, every tag, attribute (`class`, `id`, data-* or otherwise), and untouched byte of the original markup is
 * passed through unchanged - there's no tag allowlist to maintain and nothing for a model to accidentally mangle.
 *
 * Text inside `<script>` and `<style>` is skipped entirely (in both passes) since it's code, not prose.
 *
 * `HTMLRewriter`'s `Text.text` is the raw source text of the node - character references like `&amp;` or `&#39;`
 * are handed back exactly as written, not decoded. We decode with `he` before handing text off to translation
 * (so e.g. a model translating "Bed & Breakfast" sees a real `&`, not the literal string `&amp;`); `he`'s decoded
 * output is then safe to feed straight to `Text.replace(text, { html: false })` on the way back in, which
 * HTML-escapes it for us - decoding without the matching re-escape on read would otherwise double-encode entities
 * already present in the source (`&amp;` -> `&amp;amp;`).
 */

/** Registers depth-tracking handlers for `tagName` on `rewriter`, invoking `onDepthChange` whenever the depth changes. */
function trackDepth(rewriter: HTMLRewriter, tagName: string, onDepthChange: (delta: 1 | -1) => void) {
	return rewriter.on(tagName, {
		element(element) {
			onDepthChange(1);
			element.onEndTag(() => {
				onDepthChange(-1);
			});
		},
	});
}

/** Returns the decoded text of every text node in `html`, in document order, skipping `<script>`/`<style>` content. */
export async function extractHtmlText(html: string): Promise<string[]> {
	const nodes: string[] = [];
	let buffer = '';
	let skipDepth = 0;

	let rewriter = new HTMLRewriter();
	rewriter = trackDepth(rewriter, 'script', (delta) => (skipDepth += delta));
	rewriter = trackDepth(rewriter, 'style', (delta) => (skipDepth += delta));
	rewriter = rewriter.on('*', {
		text(chunk) {
			if (skipDepth > 0) {
				return;
			}

			buffer += chunk.text;
			if (chunk.lastInTextNode) {
				nodes.push(decode(buffer));
				buffer = '';
			}
		},
	});

	await rewriter.transform(new Response(html)).text();

	return nodes;
}

/**
 * Re-inserts `replacements` into `html`'s text nodes, in the same document order `extractHtmlText` produced them.
 * `replacements` must have exactly one entry per text node returned by `extractHtmlText`; a `null` entry leaves
 * that text node untouched (used for whitespace-only nodes that weren't worth translating).
 */
export async function injectHtmlText(html: string, replacements: readonly (string | null)[]): Promise<string> {
	let index = 0;
	let skipDepth = 0;
	let atNodeStart = true;

	let rewriter = new HTMLRewriter();
	rewriter = trackDepth(rewriter, 'script', (delta) => (skipDepth += delta));
	rewriter = trackDepth(rewriter, 'style', (delta) => (skipDepth += delta));
	rewriter = rewriter.on('*', {
		text(chunk) {
			if (skipDepth > 0) {
				return;
			}

			if (atNodeStart) {
				const replacement = replacements[index];
				index++;
				atNodeStart = false;

				if (replacement !== null && replacement !== undefined) {
					chunk.replace(replacement, { html: false });
				}
			} else {
				// A later chunk of a text node already handled above (HTMLRewriter can split one text node across
				// multiple `text()` events) - drop it so the replacement above isn't duplicated.
				chunk.remove();
			}

			if (chunk.lastInTextNode) {
				atNodeStart = true;
			}
		},
	});

	return rewriter.transform(new Response(html)).text();
}
