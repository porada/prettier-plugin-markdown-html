import { expect, test } from 'vite-plus/test';
import isHTMLBlockSequence, {
	canInterruptParagraph,
	findHTMLBlockEnd,
	findNonBlockLine,
	needsCompleteTagLine,
	readTakenInHTML,
	startsHTMLBlock,
} from './index.ts';

test('accepts HTML blocks for every start condition', () => {
	expect(isHTMLBlockSequence('<pre>\nfoo\n\n    bar\n</pre>')).toBe(true);
	expect(
		isHTMLBlockSequence('<textarea id="foo">\n\n    bar\n</textarea>')
	).toBe(true);
	expect(isHTMLBlockSequence('<!-- foo\n\n    bar -->')).toBe(true);
	expect(isHTMLBlockSequence('<?foo\n\n    bar ?>')).toBe(true);
	expect(isHTMLBlockSequence('<![CDATA[foo\n\n    bar]]>')).toBe(true);
	expect(isHTMLBlockSequence('<!FOO\n\n    bar>')).toBe(true);
	expect(isHTMLBlockSequence('<div\n  id="foo"\n>\n    bar\n</div>')).toBe(
		true
	);
	expect(isHTMLBlockSequence('<a href="foo" title=\'bar\' baz>\nqux')).toBe(
		true
	);
	expect(isHTMLBlockSequence('</a>\n<img\n  src="foo.png"\n/>')).toBe(true);
});

test('accepts complete closing and self-closing tags of raw text elements', () => {
	expect(isHTMLBlockSequence('</pre>\n</div>')).toBe(true);
	expect(isHTMLBlockSequence('<pre/>')).toBe(true);
	expect(isHTMLBlockSequence('<script/>')).toBe(true);
	expect(isHTMLBlockSequence('<script />')).toBe(false);
});

test('accepts HTML blocks after blank lines and closed raw blocks', () => {
	expect(isHTMLBlockSequence('<div>\n\n   <p>foo</p>\n</div>')).toBe(true);
	expect(isHTMLBlockSequence('<!-- foo -->\n<img src="bar.png" />')).toBe(
		true
	);
	expect(isHTMLBlockSequence('<div>\n \t\n<p>foo</p>')).toBe(true);
});

test('rejects lines that start indented code blocks', () => {
	expect(isHTMLBlockSequence('    <div>')).toBe(false);
	expect(isHTMLBlockSequence('<div>\n\n    <p>foo</p>\n</div>')).toBe(false);
	expect(isHTMLBlockSequence('<div>\n\n\t<p>foo</p>\n</div>')).toBe(false);
	expect(isHTMLBlockSequence('<div>\n\n \t<p>foo</p>\n</div>')).toBe(false);
});

test('rejects lines that start paragraphs', () => {
	expect(isHTMLBlockSequence('foo')).toBe(false);
	expect(isHTMLBlockSequence('<img\n  src="foo.png"\n/>')).toBe(false);
	expect(isHTMLBlockSequence('<span>foo</span>')).toBe(false);
	expect(isHTMLBlockSequence('<div>\n\nfoo\n</div>')).toBe(false);
	expect(isHTMLBlockSequence('<!-- foo -->\nbar')).toBe(false);
	expect(isHTMLBlockSequence('</pre> foo')).toBe(false);
});

test('rejects blocks that continue past the end of the text', () => {
	expect(isHTMLBlockSequence('<script>\n  foo;</script\n>')).toBe(false);
	expect(isHTMLBlockSequence('<pre>\nfoo')).toBe(false);
	expect(isHTMLBlockSequence('<textarea>\nfoo')).toBe(false);
	expect(isHTMLBlockSequence('<!-- foo')).toBe(false);
	expect(isHTMLBlockSequence('<?foo')).toBe(false);
	expect(isHTMLBlockSequence('<![CDATA[foo')).toBe(false);
});

test('accepts blocks that the source HTML leaves open as well', () => {
	expect(
		isHTMLBlockSequence(
			'<pre class="foo">\nbar',
			'<pre   class="foo">\nbar'
		)
	).toBe(true);
	expect(isHTMLBlockSequence('<pre>\nfoo', '<pre>\nfoo</pre>')).toBe(false);
	expect(isHTMLBlockSequence('<pre>\nfoo', '<!-- foo')).toBe(false);
	expect(isHTMLBlockSequence('<pre>\nfoo', 'foo\n<pre>\nbar')).toBe(false);
});

test('requires complete tags for block tags that parsers disagree on', () => {
	expect(isHTMLBlockSequence('<source src="foo.png" />')).toBe(true);
	expect(isHTMLBlockSequence('<source\n  src="foo.png"\n/>')).toBe(false);
	expect(isHTMLBlockSequence('<search\n  id="foo"\n>')).toBe(false);
});

test('detects lines that can interrupt paragraphs in the reference renderer', () => {
	expect(canInterruptParagraph('<div>foo')).toBe(true);
	expect(canInterruptParagraph('<source>foo')).toBe(true);
	expect(canInterruptParagraph('<!-- foo')).toBe(true);
	expect(canInterruptParagraph('<pre>')).toBe(true);
	expect(canInterruptParagraph('<search>')).toBe(false);
	expect(canInterruptParagraph('<span>')).toBe(false);
	expect(canInterruptParagraph('</pre>')).toBe(false);
});

test('detects lines that start HTML blocks, including Prettier’s block tags', () => {
	expect(startsHTMLBlock('<div>foo')).toBe(true);
	expect(startsHTMLBlock('<search>foo')).toBe(true);
	expect(startsHTMLBlock('<span>foo')).toBe(false);
});

test('finds the end conditions of HTML blocks that have one', () => {
	expect(findHTMLBlockEnd('<!-- foo')).toStrictEqual(/-->/);
	expect(findHTMLBlockEnd('<pre>')).toStrictEqual(
		/<\/(?:pre|script|style|textarea)>/i
	);
	expect(findHTMLBlockEnd('<div>')).toBeUndefined();
	expect(findHTMLBlockEnd('<span>')).toBeUndefined();
});

test('detects lines that start HTML blocks after spaces and tabs only', () => {
	expect(startsHTMLBlock(' \t<search>foo')).toBe(true);
	expect(startsHTMLBlock('\u00A0<search>foo')).toBe(false);
	expect(startsHTMLBlock('\u00A0</div')).toBe(false);
});

test('detects first tags that need a complete tag line', () => {
	expect(needsCompleteTagLine('<span title="foo">bar')).toBe(true);
	expect(needsCompleteTagLine('</pre>')).toBe(true);
	expect(needsCompleteTagLine('<hgroup>')).toBe(true);
	expect(needsCompleteTagLine('<div title="foo">bar')).toBe(false);
	expect(needsCompleteTagLine('<pre>foo')).toBe(false);
	expect(needsCompleteTagLine('<!-- foo -->')).toBe(false);
});

test('detects first tags that need a complete tag line after spaces and tabs only', () => {
	expect(needsCompleteTagLine(' \t<span title="foo">bar')).toBe(true);
	expect(needsCompleteTagLine('\u00A0<span title="foo">bar')).toBe(false);
});

test('finds the first line that doesn’t read as part of an HTML block', () => {
	expect(findNonBlockLine('<!-- foo -->\n>')).toBe(1);
	expect(findNonBlockLine('<!-- foo\n>\nbar -->')).toBeUndefined();
	expect(findNonBlockLine('<div>\n\nfoo')).toBe(2);
});

test('reads how a block that continues until a blank line takes in later HTML', () => {
	expect(readTakenInHTML('<p>foo</p>\n<p>bar</p>')).toBe('continues');
	expect(readTakenInHTML('<p>foo</p>\n\n<p>bar</p>')).toBe('ends');
	expect(readTakenInHTML('<pre>\nfoo\n\nbar\n</pre>')).toBe('splits');
});
